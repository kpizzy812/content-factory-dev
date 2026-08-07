import type { Prisma } from '../../app/generated/prisma/client'
import { throwIfAborted } from './pipeline-cancel-registry'
import { readFactoryContext } from './content-factory-batch'
import { findReusableLeadMagnet, type LeadMagnetLibraryClient } from './lead-magnet-library'
import {
  contentHypothesisFingerprint,
  generateContentStrategy,
  type ContentStrategyInput,
  type ContentStrategyResult,
} from './agents/content-strategy-agent'

function compactRecords(value: unknown, maxItems: number): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .slice(0, maxItems)
}

function numericIds(items: Array<Record<string, unknown>>): number[] {
  return [...new Set(items.map(item => Number(item.id)).filter(id => Number.isInteger(id) && id > 0))]
}

function funnelPromptContext(funnel: any): Record<string, unknown> | null {
  if (!funnel) return null
  return {
    id: funnel.id,
    name: funnel.name,
    keyword: funnel.keyword,
    status: funnel.status,
    leadMagnet: funnel.leadMagnet
      ? {
          id: funnel.leadMagnet.id,
          title: funnel.leadMagnet.title,
          problem: funnel.leadMagnet.problem,
          audience: funnel.leadMagnet.audience,
          content: funnel.leadMagnet.content,
          deliveryMessage: funnel.leadMagnet.deliveryMessage,
          warmupMessages: funnel.leadMagnet.warmupMessages,
          status: funnel.leadMagnet.status,
        }
      : null,
  }
}

async function loadInternalMetrics(appId: number): Promise<Array<Record<string, unknown>>> {
  const rows = await prisma.postMetrics.findMany({
    where: { upload: { socialAccount: { appId } } },
    orderBy: { collectedAt: 'desc' },
    take: 40,
    select: {
      views: true,
      likes: true,
      comments: true,
      shares: true,
      watchThrough: true,
      ctr: true,
      followerGain: true,
      collectedAt: true,
      upload: { select: { title: true, description: true, hashtags: true } },
    },
  })
  return rows.map(row => ({
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    watchThrough: row.watchThrough,
    ctr: row.ctr,
    followerGain: row.followerGain,
    collectedAt: row.collectedAt.toISOString(),
    title: row.upload.title,
    description: row.upload.description,
    hashtags: row.upload.hashtags,
  }))
}

async function loadTrendBank(appId: number): Promise<{
  trends: Array<Record<string, unknown>>
  ideas: Array<Record<string, unknown>>
}> {
  const [trendRows, ideaRows] = await Promise.all([
    prisma.trend.findMany({
      where: {
        isDeleted: false,
        status: { not: 'dismissed' },
        OR: [{ appId }, { appId: null }],
      },
      orderBy: [{ viewCount: 'desc' }, { importedAt: 'desc' }],
      take: 24,
      select: {
        id: true,
        platform: true,
        sourceUrl: true,
        title: true,
        description: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        shareCount: true,
        hashtags: true,
        publishedAt: true,
        insights: {
          select: { whyViral: true, patterns: true, hooks: true, audience: true, confidence: true },
        },
        brief: {
          select: {
            hookAnalysis: true,
            sceneStructure: true,
            visualStyle: true,
            viralityReasons: true,
            summary: true,
            confidence: true,
          },
        },
      },
    }),
    prisma.idea.findMany({
      where: {
        appId,
        isDeleted: false,
        status: { in: ['ready', 'in_work', 'completed'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      select: {
        id: true,
        platform: true,
        title: true,
        hook: true,
        body: true,
        cta: true,
        visualStyle: true,
        whyViral: true,
        tags: true,
        createdAt: true,
      },
    }),
  ])
  return {
    trends: trendRows.map(row => ({
      ...row,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    })),
    ideas: ideaRows.map(row => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

export async function executeContentStrategyNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  throwIfAborted(signal)
  const runId = Number(input._runId) || undefined
  const factory = readFactoryContext(input)

  if (runId) {
    const existing = await prisma.contentHypothesis.findUnique({
      where: { runId },
      include: { funnel: { include: { leadMagnet: true } }, leadMagnet: true },
    })
    if (existing) {
      return {
        appId: existing.appId,
        hypothesis: existing,
        hypotheses: [existing],
        trends: [],
        funnel: existing.funnel,
        leadMagnet: existing.funnel?.leadMagnet ?? existing.leadMagnet,
        funnelReady: existing.funnel?.status === 'active',
        reused: true,
      }
    }
  }

  const run = runId
    ? await prisma.workflowRun.findUnique({ where: { id: runId }, select: { cycleId: true, trackingToken: true } })
    : null
  const cycleId = factory?.cycleId ?? run?.cycleId ?? undefined
  const cycle = cycleId
    ? await prisma.productionCycle.findUnique({ where: { id: cycleId }, select: { appId: true, funnelId: true } })
    : null
  const appId = Number(config.appId) || Number(input.appId) || cycle?.appId || undefined
  if (!appId) throw new Error('Content Strategy: appId is required')

  const app = await prisma.app.findUnique({ where: { id: appId } })
  if (!app) throw new Error(`Content Strategy: app #${appId} not found`)

  const funnelId = typeof input.funnelId === 'string' && input.funnelId
    ? input.funnelId
    : typeof config.funnelId === 'string' && config.funnelId
      ? config.funnelId
      : cycle?.funnelId ?? undefined
  const funnel = funnelId
    ? await prisma.contentFunnel.findFirst({
        where: { id: funnelId, appId },
        include: { leadMagnet: true },
      })
    : null
  if (funnelId && (!funnel || funnel.status !== 'active')) {
    throw new Error('Content Strategy: selected funnel is missing or inactive')
  }

  let trends = compactRecords(input.trends, 24)
  let ideas = compactRecords(input.ideas, 12)
  if (config.useTrendBank !== false && trends.length === 0 && ideas.length === 0) {
    const bank = await loadTrendBank(appId)
    trends = bank.trends
    ideas = bank.ideas
  }
  const internalMetrics = config.useInternalMetrics === false ? [] : await loadInternalMetrics(appId)
  const ordinal = factory && typeof (input._factory as Record<string, unknown>)?.ordinal === 'number'
    ? Number((input._factory as Record<string, unknown>).ordinal)
    : Number(input.ordinal) || undefined
  const trackingToken = factory?.trackingToken ?? run?.trackingToken ?? undefined
  const baseAgentInput: ContentStrategyInput = {
    app: {
      id: app.id,
      name: app.name,
      description: app.description,
      language: app.language,
      targetAudience: app.targetAudience,
      brandTone: app.brandTone,
      corePain: app.corePain,
      coreOutcome: app.coreOutcome,
      transformationPromise: app.transformationPromise,
      featureBullets: app.featureBullets,
      creativeAngles: app.creativeAngles,
      forbiddenClaims: app.forbiddenClaims,
      riskyClaims: app.riskyClaims,
    },
    trends,
    ideas,
    internalMetrics,
    funnel: funnelPromptContext(funnel),
    ordinal,
    trackingToken,
    extraContext: input.context && typeof input.context === 'object'
      ? input.context as Record<string, unknown>
      : config.context && typeof config.context === 'object'
        ? config.context as Record<string, unknown>
        : undefined,
  }

  let generated: ContentStrategyResult | null = null
  let fingerprint = ''
  const avoidFingerprints: string[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    throwIfAborted(signal)
    generated = await generateContentStrategy({ ...baseAgentInput, avoidFingerprints })
    if (funnel) {
      generated.keyword = funnel.keyword
      if (!generated.cta.toLocaleLowerCase().includes(funnel.keyword.toLocaleLowerCase())) {
        const keywordCta = app.language?.toLowerCase().startsWith('ru')
          ? `Напишите «${funnel.keyword}» в комментариях.`
          : `Comment "${funnel.keyword}".`
        generated.cta = `${generated.cta.replace(/[.!?]+$/, '')}. ${keywordCta}`
      }
    }
    fingerprint = contentHypothesisFingerprint(generated)
    if (!cycleId) break
    const duplicate = await prisma.contentHypothesis.findFirst({ where: { cycleId, fingerprint }, select: { id: true } })
    if (!duplicate) break
    avoidFingerprints.push(fingerprint)
    generated = null
  }
  if (!generated) throw new Error('Content Strategy produced a duplicate hypothesis three times')

  const sourceTrendIds = numericIds(trends)
  const sourceIdeaIds = numericIds(ideas)
  const created = await prisma.$transaction(async (tx) => {
    // Порядок поиска материала: магнит воронки → подходящий из библиотеки
    // приложения → только потом новый черновик. Без среднего шага каждый прогон
    // партии плодил новый черновик (до 300 в сутки), который к тому же некому
    // было утверждать.
    const reused = funnel?.leadMagnet
      ? null
      : config.reuseLeadMagnets === false
        ? null
        : await findReusableLeadMagnet(tx as unknown as LeadMagnetLibraryClient, appId, {
            title: generated!.leadMagnet.title,
            problem: generated!.leadMagnet.problem,
            audience: generated!.leadMagnet.audience,
          }) as { id: string } | null

    const leadMagnet = funnel?.leadMagnet ?? reused ?? await tx.leadMagnet.create({
      data: {
        appId,
        title: generated!.leadMagnet.title,
        problem: generated!.leadMagnet.problem,
        audience: generated!.leadMagnet.audience,
        content: {
          format: generated!.leadMagnet.format,
          sections: generated!.leadMagnet.sections,
        } as Prisma.InputJsonValue,
        deliveryMessage: generated!.leadMagnet.deliveryMessage,
        warmupMessages: generated!.leadMagnet.warmupMessages as unknown as Prisma.InputJsonValue,
        status: 'draft',
      },
    })

    // Привязываем магнит к воронке, а не только к гипотезе: выдачу материала в
    // мессенджере (factory-automation) и атрибуцию интересует именно
    // funnel.leadMagnet — без этой строки лид-магнит физически некому отдать.
    // updateMany с leadMagnetId: null — защита от гонки параллельных прогонов:
    // кто привязал первым, того и магнит, второй прогон ничего не перетирает.
    if (funnel && !funnel.leadMagnetId) {
      await tx.contentFunnel.updateMany({
        where: { id: funnel.id, leadMagnetId: null },
        data: { leadMagnetId: leadMagnet.id },
      })
    }

    const hypothesis = await tx.contentHypothesis.create({
      data: {
        appId,
        cycleId: cycleId ?? null,
        runId: runId ?? null,
        trackingToken: trackingToken ?? null,
        funnelId: funnel?.id ?? null,
        leadMagnetId: leadMagnet.id,
        ordinal: ordinal ?? null,
        title: generated!.title,
        angle: generated!.angle,
        audience: generated!.audience,
        problem: generated!.problem,
        promise: generated!.promise,
        hook: generated!.hook,
        cta: generated!.cta,
        keyword: funnel?.keyword ?? generated!.keyword,
        proofPoints: generated!.proofPoints as unknown as Prisma.InputJsonValue,
        evidence: {
          rationale: generated!.rationale,
          internalMetricsCount: internalMetrics.length,
        } as Prisma.InputJsonValue,
        sourceTrendIds,
        sourceIdeaIds,
        fingerprint,
        rawOutput: generated as unknown as Prisma.InputJsonValue,
      },
      include: { funnel: { include: { leadMagnet: true } }, leadMagnet: true },
    })

    if (runId) {
      await tx.factoryPublication.updateMany({
        where: { runId },
        data: {
          hypothesisId: hypothesis.id,
          ...(funnel ? { funnelId: funnel.id, keyword: funnel.keyword } : {}),
        },
      })
    }
    return hypothesis
  })

  return {
    appId,
    hypothesis: created,
    hypotheses: [created],
    trends: [],
    funnel: created.funnel,
    leadMagnet: created.funnel?.leadMagnet ?? created.leadMagnet,
    funnelReady: created.funnel?.status === 'active',
    reused: false,
  }
}
