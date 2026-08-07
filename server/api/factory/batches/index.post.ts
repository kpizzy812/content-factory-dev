import type { Prisma } from '../../../../app/generated/prisma/client'
import { computePublishingCapacity, nextRecoveryAt } from '../../../utils/accounts/publishing-capacity'
import { enqueueRun } from '../../../utils/pipeline-runtime'
import { validatePipeline } from '../../../utils/pipeline-validator'
import {
  createFactoryTrackingToken,
  inspectFactoryPipeline,
  planFactoryAssignments,
  type FactoryPlatform,
} from '../../../utils/content-factory-batch'

const VALID_PLATFORMS = new Set<FactoryPlatform>(['instagram', 'tiktok', 'youtube'])
const MAX_BATCH_SIZE = 300
const MAX_DAILY_LIMIT = 50

function parsePositiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter(id => Number.isInteger(id) && id > 0))]
}

function parsePlatforms(value: unknown): FactoryPlatform[] {
  const raw = Array.isArray(value) ? value : ['instagram']
  return [...new Set(raw.map(String).filter((item): item is FactoryPlatform => VALID_PLATFORMS.has(item as FactoryPlatform)))]
}

export default defineEventHandler(async (event) => {
  const firstUser = await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: 'Тело запроса обязательно' })
  }

  const appId = Number(body.appId)
  const pipelineId = Number(body.pipelineId)
  const count = Math.trunc(Number(body.count))
  const dailyLimitPerAccount = body.dailyLimitPerAccount == null
    ? MAX_DAILY_LIMIT
    : Math.trunc(Number(body.dailyLimitPerAccount))
  const platforms = parsePlatforms(body.platforms)
  const requestedAccountIds = parsePositiveIds(body.accountIds)
  const groupId = body.groupId == null ? undefined : Number(body.groupId)
  const batchKey = typeof body.batchKey === 'string' && body.batchKey.trim()
    ? body.batchKey.trim().slice(0, 160)
    : null
  const requestedKeyword = typeof body.keyword === 'string' && body.keyword.trim()
    ? body.keyword.trim().slice(0, 64)
    : undefined
  const funnelId = typeof body.funnelId === 'string' && body.funnelId.trim() ? body.funnelId.trim() : undefined
  const sourceContext = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
    ? body.context as Record<string, unknown>
    : {}

  if (!Number.isInteger(appId) || appId <= 0) throw createError({ statusCode: 400, message: 'appId обязателен' })
  if (!Number.isInteger(pipelineId) || pipelineId <= 0) throw createError({ statusCode: 400, message: 'pipelineId обязателен' })
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_SIZE) {
    throw createError({ statusCode: 400, message: `count должен быть целым числом 1..${MAX_BATCH_SIZE}` })
  }
  if (!Number.isInteger(dailyLimitPerAccount) || dailyLimitPerAccount < 1 || dailyLimitPerAccount > MAX_DAILY_LIMIT) {
    throw createError({ statusCode: 400, message: `dailyLimitPerAccount должен быть 1..${MAX_DAILY_LIMIT}` })
  }
  if (platforms.length === 0) throw createError({ statusCode: 400, message: 'Нужна хотя бы одна платформа' })
  if (groupId !== undefined && (!Number.isInteger(groupId) || groupId <= 0)) {
    throw createError({ statusCode: 400, message: 'Некорректный groupId' })
  }

  const user = await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
    appId,
  })
  if (user.id !== firstUser.id) throw createError({ statusCode: 403, message: 'Контекст доступа изменился' })

  if (batchKey) {
    const existing = await prisma.productionCycle.findUnique({ where: { batchKey } })
    if (existing) {
      if (existing.startedById !== user.id && !user.canAdmin) throw createError({ statusCode: 403, message: 'batchKey уже занят' })
      return { data: existing, reused: true }
    }
  }

  const [app, pipeline, funnel] = await Promise.all([
    prisma.app.findUnique({ where: { id: appId }, select: { id: true, name: true } }),
    prisma.pipeline.findUnique({ where: { id: pipelineId } }),
    funnelId
      ? prisma.contentFunnel.findFirst({
          where: { id: funnelId, appId, status: 'active' },
          select: {
            id: true,
            keyword: true,
            leadMagnetId: true,
            leadMagnet: { select: { status: true } },
          },
        })
      : Promise.resolve(null),
  ])
  if (!app) throw createError({ statusCode: 404, message: 'Приложение не найдено' })
  if (!pipeline) throw createError({ statusCode: 404, message: 'Конвейер не найден' })
  if (funnelId && !funnel) throw createError({ statusCode: 404, message: 'Активная воронка не найдена в выбранном приложении' })
  const requirements = inspectFactoryPipeline(pipeline.graphData)
  if (requirements.requiresFunnel && !funnel) {
    throw createError({ statusCode: 400, message: 'Для этого конвейера нужна активная воронка с кодовым словом' })
  }
  if (requirements.requiresApprovedLeadMagnet && funnel?.leadMagnet?.status !== 'approved') {
    throw createError({ statusCode: 400, message: 'Лид-магнит выбранной воронки должен быть утверждён до запуска партии' })
  }
  const hasPipelineAccess = pipeline.userId === user.id || pipeline.sharedWith.includes(user.id) || user.canAdmin
  if (!hasPipelineAccess) throw createError({ statusCode: 403, message: 'Нет доступа к конвейеру' })
  if (pipeline.status !== 'active') throw createError({ statusCode: 400, message: 'Конвейер не активен' })
  const keyword = requestedKeyword ?? funnel?.keyword
  const effectiveSourceContext = {
    ...sourceContext,
    appId,
    ...(funnel ? { funnelId: funnel.id, leadMagnetId: funnel.leadMagnetId } : {}),
  }

  const validation = await validatePipeline(pipelineId)
  if (!validation.ready) {
    const errors = validation.issues.filter(issue => issue.severity === 'error')
    throw createError({ statusCode: 400, message: `Конвейер не готов: ${errors.map(error => error.message).join('; ')}` })
  }

  if (groupId) {
    const group = await prisma.accountGroup.findFirst({ where: { id: groupId, appId }, select: { id: true } })
    if (!group) throw createError({ statusCode: 404, message: 'Группа аккаунтов не найдена в выбранном приложении' })
  }

  const accounts = await prisma.socialAccount.findMany({
    where: {
      appId,
      status: 'active',
      postingMethod: 'api',
      platform: { in: platforms as never },
      ...(requestedAccountIds.length > 0 ? { id: { in: requestedAccountIds } } : {}),
      ...(groupId ? { groups: { some: { groupId } } } : {}),
    },
    // Квоту тянем вместе с аккаунтом: планировать партию надо по фактическому
    // `content_publishing_limit`, а не по одному числу на всех (PROJECT_CONTEXT §3).
    select: {
      id: true,
      platform: true,
      lastPostedAt: true,
      publishingQuotaTotal: true,
      publishingQuotaUsage: true,
      publishingQuotaAt: true,
    },
    orderBy: [{ lastPostedAt: 'asc' }, { id: 'asc' }],
  })

  if (requestedAccountIds.length > 0) {
    const found = new Set(accounts.map(account => account.id))
    const missing = requestedAccountIds.filter(id => !found.has(id))
    if (missing.length > 0) {
      throw createError({ statusCode: 400, message: `Аккаунты недоступны, неактивны, без официального API или относятся к другому приложению: ${missing.join(', ')}` })
    }
  }

  const dayStartUtc = new Date()
  dayStartUtc.setUTCHours(0, 0, 0, 0)
  const accountIds = accounts.map(account => account.id)
  const [factoryUsage, uploadUsage] = accountIds.length > 0
    ? await Promise.all([
        prisma.factoryPublication.groupBy({
          by: ['socialAccountId'],
          where: {
            socialAccountId: { in: accountIds },
            createdAt: { gte: dayStartUtc },
            status: { notIn: ['failed', 'cancelled'] },
          },
          _count: { _all: true },
        }),
        prisma.upload.groupBy({
          by: ['socialAccountId'],
          where: {
            socialAccountId: { in: accountIds },
            createdAt: { gte: dayStartUtc },
            status: { notIn: ['failed', 'canceled'] },
          },
          _count: { _all: true },
        }),
      ])
    : [[], []]
  const factoryCounts = new Map(factoryUsage.map(row => [row.socialAccountId, row._count._all]))
  const uploadCounts = new Map(uploadUsage.map(row => [row.socialAccountId, row._count._all]))
  const usage = new Map<number, number>()
  for (const accountId of accountIds) {
    usage.set(accountId, Math.max(factoryCounts.get(accountId) ?? 0, uploadCounts.get(accountId) ?? 0))
  }
  const plan = planFactoryAssignments({
    count,
    platforms,
    dailyLimitPerAccount,
    accounts: accounts.map(account => ({
      id: account.id,
      platform: account.platform as FactoryPlatform,
      currentUsage: usage.get(account.id) ?? 0,
      lastPostedAt: account.lastPostedAt,
      quotaTotal: account.publishingQuotaTotal,
      quotaUsage: account.publishingQuotaUsage,
      quotaCheckedAt: account.publishingQuotaAt,
    })),
  })
  // Фолбэк — это «мы не знаем настоящий лимит», и молчать об этом нельзя:
  // партия могла разложиться по выдуманному числу слотов.
  if (plan.fallbacks.length > 0) {
    console.warn(
      '[factory-batch] квота площадки неизвестна, планируем по фолбэку',
      { appId, fallbackDailyLimit: dailyLimitPerAccount, accounts: plan.fallbacks },
    )
  }
  if (!plan.ok) {
    // Нехватка слотов — это «нельзя сейчас», а не «нельзя никогда»: отдаём
    // оператору момент, к которому по прогнозу освободится нужное число слотов.
    const missing = plan.shortages.reduce(
      (max, item) => Math.max(max, item.requestedSlots - item.availableSlots),
      0,
    )
    const snapshot = await computePublishingCapacity({ appId })
    throw createError({
      statusCode: 409,
      message: 'Недостаточно аккаунтов для выпуска партии за одни сутки',
      data: {
        capacity: plan.capacity,
        shortages: plan.shortages,
        limits: plan.limits,
        retryAt: nextRecoveryAt(snapshot.recovery, missing) ?? snapshot.fullyRecoveredAt,
      },
    })
  }

  const effectiveBatchKey = batchKey ?? `factory-${crypto.randomUUID()}`
  let cycle
  try {
    cycle = await prisma.$transaction(async (tx) => {
      const created = await tx.productionCycle.create({
        data: {
          appId,
          groupId: groupId ?? null,
          mode: 'pipeline_batch',
          pipelineId,
          funnelId: funnel?.id ?? null,
          batchKey: effectiveBatchKey,
          targetCount: count,
          dailyLimitPerAccount,
          sourceContext: effectiveSourceContext as Prisma.InputJsonValue,
          startedById: user.id,
          status: 'running',
        },
      })

      const plannedRuns = plan.items.map(item => {
        const trackingToken = createFactoryTrackingToken(created.id, item.ordinal)
        return {
          trackingToken,
          assignments: item.assignments,
          data: {
            pipelineId,
            cycleId: created.id,
            triggeredBy: user.id,
            triggerType: 'manual' as const,
            status: 'pending' as const,
            trackingToken,
            inputContext: {
              ...effectiveSourceContext,
              _factory: {
                cycleId: created.id,
                ordinal: item.ordinal,
                funnelId: funnel?.id,
                leadMagnetId: funnel?.leadMagnetId ?? undefined,
                trackingToken,
                keyword,
                assignments: item.assignments,
              },
            } as Prisma.InputJsonValue,
            graphSnapshot: pipeline.graphData as Prisma.InputJsonValue,
          },
        }
      })

      await tx.workflowRun.createMany({
        data: plannedRuns.map(item => item.data),
      })

      const createdRuns = await tx.workflowRun.findMany({
        where: { cycleId: created.id },
        select: { id: true, trackingToken: true },
      })
      const runIds = new Map(createdRuns.map(run => [run.trackingToken, run.id]))
      await tx.factoryPublication.createMany({
        data: plannedRuns.flatMap(item => item.assignments.map(assignment => ({
          appId,
          cycleId: created.id,
          runId: runIds.get(item.trackingToken)!,
          funnelId: funnel?.id ?? null,
          socialAccountId: assignment.socialAccountId,
          platform: assignment.platform as never,
          trackingToken: item.trackingToken,
          keyword: keyword ?? null,
          status: 'planned',
        }))),
      })
      return created
    })
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      const existing = await prisma.productionCycle.findUnique({ where: { batchKey: effectiveBatchKey } })
      if (existing) return { data: existing, reused: true }
    }
    throw error
  }

  const runs = await prisma.workflowRun.findMany({
    where: { cycleId: cycle.id },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const wakeResults = await Promise.allSettled(runs.slice(0, 10).map(run => enqueueRun(run.id)))
  const started = wakeResults.filter(result => result.status === 'fulfilled' && result.value === 'started').length

  return {
    data: cycle,
    reused: false,
    queue: { total: runs.length, started, pending: runs.length - started },
    capacity: plan.capacity,
  }
})
