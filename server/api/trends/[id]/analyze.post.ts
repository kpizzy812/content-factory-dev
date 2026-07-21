import { runTrendAnalyzer, PROMPT_VERSION } from '~~/server/utils/agents/trend-analyzer-agent'
import type { TrendAnalysisInput } from '~~/shared/types/agents'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'trendwatcher' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Invalid trend ID",
    })
  }

  const trend = await prisma.trend.findUnique({
    where: { id },
    include: { app: true },
  })

  if (!trend) {
    throw createError({ statusCode: 404, message: "Тренд не найден" })
  }

  if (trend.isDeleted) {
    throw createError({ statusCode: 400, message: "Невозможно анализировать удалённый тренд" })
  }

  if (trend.analysisStatus === 'running') {
    throw createError({ statusCode: 409, message: "Анализ уже выполняется" })
  }

  // Set status to running
  await prisma.trend.update({
    where: { id },
    data: { analysisStatus: 'running' },
  })

  const modelVersion = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

  try {
    const input: TrendAnalysisInput = {
      platform: trend.platform,
      title: trend.title,
      description: trend.description,
      authorName: trend.authorName,
      hashtags: trend.hashtags,
      viewCount: trend.viewCount,
      likeCount: trend.likeCount,
      commentCount: trend.commentCount,
      shareCount: trend.shareCount,
      publishedAt: trend.publishedAt?.toISOString() ?? null,
      language: trend.language,
      geo: trend.geo,
      thumbnailUrl: trend.thumbnailUrl,
      sourceUrl: trend.sourceUrl,
    }

    const analysis = await runTrendAnalyzer(input)

    // Upsert CreativeBrief
    const brief = await prisma.creativeBrief.upsert({
      where: { trendId: id },
      create: {
        trendId: id,
        hookAnalysis: analysis.hookAnalysis as object,
        sceneStructure: analysis.sceneStructure as object,
        visualStyle: analysis.visualStyle as object,
        viralityReasons: analysis.viralityReasons as object,
        summary: analysis.summary,
        confidence: analysis.confidence ?? null,
        modelVersion,
        promptVersion: PROMPT_VERSION,
      },
      update: {
        hookAnalysis: analysis.hookAnalysis as object,
        sceneStructure: analysis.sceneStructure as object,
        visualStyle: analysis.visualStyle as object,
        viralityReasons: analysis.viralityReasons as object,
        summary: analysis.summary,
        confidence: analysis.confidence ?? null,
        modelVersion,
        promptVersion: PROMPT_VERSION,
        errorMessage: null,
      },
    })

    // Also create/update TrendInsight for backward compatibility
    const insightData = {
      whyViral: analysis.viralityReasons.primaryReason,
      patterns: analysis.viralityReasons.factors.map(f => f.factor),
      hooks: [analysis.hookAnalysis.description],
      audience: analysis.viralityReasons.targetAudience,
      confidence: analysis.confidence ?? null,
    }

    await prisma.trendInsight.upsert({
      where: { trendId: id },
      create: { trendId: id, ...insightData },
      update: insightData,
    })

    // Update trend status
    await prisma.trend.update({
      where: { id },
      data: { analysisStatus: 'completed' },
    })

    return { data: brief }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown analysis error'

    // Update status to failed
    await prisma.trend.update({
      where: { id },
      data: { analysisStatus: 'failed' },
    })

    // Store error in brief if it exists
    await prisma.creativeBrief.upsert({
      where: { trendId: id },
      create: {
        trendId: id,
        hookAnalysis: {},
        sceneStructure: {},
        visualStyle: {},
        viralityReasons: {},
        summary: '',
        modelVersion,
        promptVersion: PROMPT_VERSION,
        errorMessage,
      },
      update: { errorMessage },
    }).catch(() => {})

    throw createError({
      statusCode: 500,
      message: `Ошибка AI-анализа: ${errorMessage}`,
    })
  }
})
