import type { OptimizationRequirement, ScenarioFeedbackDerived } from '~~/shared/types/story'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'script-generator',
  })

  const body = await readBody<{
    feedbackText: string
    scenarioId?: number
    videoId?: number
    uploadId?: number
  }>(event)

  // Валидация: feedbackText обязателен
  if (!body?.feedbackText || typeof body.feedbackText !== 'string' || !body.feedbackText.trim()) {
    throw createError({
      statusCode: 400,
      message: "Поле 'feedbackText' обязательно и не может быть пустым",
    })
  }

  const feedbackText = body.feedbackText.trim()

  // Контекст для AI-анализа
  let context: { scenarioTitle?: string; platform?: string } | undefined
  let appId: number | null = null

  // Если scenarioId — проверяем что сценарий существует
  if (body.scenarioId !== undefined) {
    const scenarioId = Number(body.scenarioId)
    if (Number.isNaN(scenarioId) || scenarioId <= 0) {
      throw createError({
        statusCode: 400,
        message: "Поле 'scenarioId' должно быть числом > 0",
      })
    }

    const scenario = await prisma.scenario.findUnique({
      where: { id: scenarioId },
      include: {
        trend: { select: { title: true, platform: true, appId: true } },
        variants: {
          where: { isDeleted: false },
          orderBy: { variantIndex: 'asc' },
          take: 1,
          select: { title: true },
        },
      },
    })

    if (!scenario) {
      throw createError({
        statusCode: 404,
        message: 'Сценарий не найден',
      })
    }

    context = {
      scenarioTitle: scenario.variants[0]?.title ?? scenario.trend.title,
      platform: scenario.trend.platform,
    }

    appId = scenario.appId ?? scenario.trend.appId ?? null
  }

  // Сохраняем feedback
  const feedback = await prisma.scenarioFeedback.create({
    data: {
      scenarioId: body.scenarioId ? Number(body.scenarioId) : null,
      videoId: body.videoId ? Number(body.videoId) : null,
      uploadId: body.uploadId ? Number(body.uploadId) : null,
      feedbackText,
      source: 'operator',
    },
  })

  // AI-анализ: извлекаем insights из текста feedback
  // Если AI упадёт — feedback всё равно сохранён
  try {
    const derived = await deriveFeedbackInsights(feedbackText, context)

    // Обновляем feedback с derived данными
    await prisma.scenarioFeedback.update({
      where: { id: feedback.id },
      data: {
        derived: derived as any,
        sentiment: derived.sentiment,
      },
    })

    // Обновляем optimization memory: создаём OptimizationRequirement для каждого инсайта
    const now = new Date().toISOString()

    const entries: OptimizationRequirement[] = [
      ...derived.requirements.map((text): OptimizationRequirement => ({
        type: 'requirement',
        category: 'general',
        text,
        source: 'human_feedback',
        sourceId: feedback.id,
        weight: 70,
        createdAt: now,
      })),
      ...derived.recommendations.map((text): OptimizationRequirement => ({
        type: 'recommendation',
        category: 'general',
        text,
        source: 'human_feedback',
        sourceId: feedback.id,
        weight: 50,
        createdAt: now,
      })),
      ...derived.antiPatterns.map((text): OptimizationRequirement => ({
        type: 'anti_pattern',
        category: 'general',
        text,
        source: 'human_feedback',
        sourceId: feedback.id,
        weight: 80,
        createdAt: now,
      })),
    ]

    // Сохраняем каждый инсайт в optimization memory
    for (const entry of entries) {
      await updateOptimizationMemory(entry, appId)
    }

    // Возвращаем обновлённый feedback с derived
    const updatedFeedback = await prisma.scenarioFeedback.findUnique({
      where: { id: feedback.id },
    })

    return { data: updatedFeedback }
  }
  catch {
    // AI-анализ не обязателен — возвращаем feedback без derived
    return { data: feedback }
  }
})
