const VALID_FORMATS = ["portrait", "landscape"] as const
const VALID_QUALITIES = ["low", "medium", "high"] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canCreate', 'canRunAgent'], moduleSlug: 'video-generator' })

  const body = await readBody<{
    scenarioId?: number
    format?: string
    // Output configuration
    subtitlesEnabled?: boolean
    subtitlesStyle?: Record<string, unknown>
    musicEnabled?: boolean
    musicMood?: string
    musicDuration?: number
    musicVolume?: number
    musicVolumeWithVoiceover?: number
    clipDuration?: number
    imageCount?: number
    renderQuality?: string
    targetPlatform?: string
    // Model selection
    imageModelId?: string
    videoModelId?: string
    modelStrategy?: string
    generateAudio?: boolean
    // Voiceover
    voiceoverEnabled?: boolean
    voiceoverModelId?: string | null
    voiceoverVoiceId?: string | null
    voiceoverLanguage?: string
    voiceoverPacing?: string
    voiceoverReconciliation?: string
    // Lip-sync (premium)
    lipSyncEnabled?: boolean
    lipSyncModelId?: string | null
    // Story-driven options
    forceImageGeneration?: boolean  // force images even in story-driven mode
  }>(event)

  // Валидация scenarioId
  if (!body?.scenarioId || typeof body.scenarioId !== "number" || body.scenarioId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'scenarioId' обязательно и должно быть числом > 0",
    })
  }

  // Валидация format
  const format = body.format || "portrait"
  if (!VALID_FORMATS.includes(format as typeof VALID_FORMATS[number])) {
    throw createError({
      statusCode: 400,
      message: `Поле 'format' должно быть одним из: ${VALID_FORMATS.join(", ")}`,
    })
  }

  // Валидация imageCount
  const imageCount = body.imageCount ?? 3
  if (typeof imageCount !== "number" || !Number.isInteger(imageCount) || imageCount < 1 || imageCount > 10) {
    throw createError({
      statusCode: 400,
      message: "Поле 'imageCount' должно быть целым числом от 1 до 10",
    })
  }

  // Валидация quality
  const renderQuality = body.renderQuality || "medium"
  if (!VALID_QUALITIES.includes(renderQuality as typeof VALID_QUALITIES[number])) {
    throw createError({
      statusCode: 400,
      message: `Поле 'renderQuality' должно быть одним из: ${VALID_QUALITIES.join(", ")}`,
    })
  }

  // Валидация моделей
  if (body.imageModelId) {
    const model = getModel(body.imageModelId)
    if (!model || model.task !== 'image') {
      throw createError({ statusCode: 400, message: `Неизвестная модель изображений: ${body.imageModelId}` })
    }
    if (!model.integrated) {
      throw createError({ statusCode: 400, message: `Модель ${model.name} пока не подключена к системе` })
    }
  }
  if (body.videoModelId) {
    const model = getModel(body.videoModelId)
    if (!model || model.task !== 'video') {
      throw createError({ statusCode: 400, message: `Неизвестная модель видео: ${body.videoModelId}` })
    }
    if (!model.integrated) {
      throw createError({ statusCode: 400, message: `Модель ${model.name} пока не подключена к системе` })
    }
  }

  // Валидация TTS модели
  if (body.voiceoverEnabled && body.voiceoverModelId) {
    const model = getModel(body.voiceoverModelId)
    if (!model || model.task !== 'tts') {
      throw createError({ statusCode: 400, message: `Неизвестная TTS модель: ${body.voiceoverModelId}` })
    }
    if (!model.integrated) {
      throw createError({ statusCode: 400, message: `TTS модель ${model.name} пока не подключена к системе` })
    }
  }

  // Валидация modelStrategy
  const validStrategies = ['auto', 'budget', 'fast_draft', 'balanced', 'story_continuity', 'high_realism']
  if (body.modelStrategy && !validStrategies.includes(body.modelStrategy)) {
    throw createError({ statusCode: 400, message: `Неизвестная strategy: ${body.modelStrategy}` })
  }

  // Валидация voiceoverPacing
  const validPacings = ['slow', 'moderate', 'fast']
  if (body.voiceoverPacing && !validPacings.includes(body.voiceoverPacing)) {
    throw createError({ statusCode: 400, message: `Неизвестный pacing: ${body.voiceoverPacing}` })
  }

  // Preflight: проверяем реальную доступность моделей для текущего FAL_KEY
  const { falProbeAccessBatch } = await import('~~/server/utils/fal')
  const modelsToCheck = [
    body.imageModelId || 'fal-ai/flux/dev',
    body.videoModelId || 'fal-ai/kling-video/v3/standard/text-to-video',
  ]
  const accessResults = await falProbeAccessBatch(modelsToCheck)
  for (const [endpoint, result] of accessResults) {
    if (result.status !== 'available') {
      const modelMeta = getModel(endpoint)
      throw createError({
        statusCode: 403,
        message: `Нет доступа к модели "${modelMeta?.name ?? endpoint}": ${result.reason}`,
      })
    }
  }

  // Проверка существования сценария
  const scenario = await prisma.scenario.findUnique({
    where: { id: body.scenarioId },
    include: {
      variants: {
        where: { status: "accepted" as never },
        take: 1,
      },
    },
  })

  if (!scenario) {
    throw createError({
      statusCode: 404,
      message: "Сценарий не найден",
    })
  }

  if (scenario.status !== "selected") {
    throw createError({
      statusCode: 400,
      message: `Сценарий должен быть в статусе 'selected', текущий: ${scenario.status}`,
    })
  }

  const acceptedVariant = scenario.variants[0]
  if (!acceptedVariant) {
    throw createError({
      statusCode: 400,
      message: "У сценария нет принятого варианта",
    })
  }

  // Проверка дубля: нет активного Video для этого сценария
  const activeStatuses = ["pending", "configuring", "generating_prompts", "generating_images", "generating_clips", "generating_music", "assembling"]
  const activeVideo = await prisma.video.findFirst({
    where: {
      scenarioId: body.scenarioId,
      status: { in: activeStatuses as never[] },
    },
  })

  if (activeVideo) {
    throw createError({
      statusCode: 409,
      message: "Для этого сценария уже есть активное видео в процессе генерации",
    })
  }

  // Story-driven auto-detection: adjust imageCount to match scene count
  const storyPlan = acceptedVariant.storyPlan as { scenes?: unknown[] } | null
  const storySceneCount = storyPlan?.scenes?.length ?? 0
  const isStoryDriven = storySceneCount >= 2

  // В story-driven mode расширяем imageCount до числа сцен чтобы не терять сцены
  const effectiveImageCount = isStoryDriven
    ? Math.max(imageCount, storySceneCount)
    : imageCount

  // Pre-check: если voiceover enabled но story plan не содержит voiceover lines — warning (не error)
  const rawStoryPlan = acceptedVariant.storyPlan as { voiceoverPlan?: { enabled?: boolean; lines?: unknown[] } } | null
  const storyHasVoiceoverLines = !!rawStoryPlan?.voiceoverPlan?.enabled
    && Array.isArray(rawStoryPlan.voiceoverPlan.lines)
    && (rawStoryPlan.voiceoverPlan.lines?.length ?? 0) > 0

  if (body.voiceoverEnabled && !storyHasVoiceoverLines) {
    // Не блокируем — voiceover step сам пропустится и запишет warning,
    // но честно сообщаем в ответе что озвучки не будет.
  }

  // Если фронт явно не передал voiceoverEnabled, а storyPlan содержит запланированные
  // реплики — включаем озвучку автоматически. Раньше default=false проглатывал звук.
  const resolvedVoiceoverEnabled = body.voiceoverEnabled === true
    ? true
    : body.voiceoverEnabled === false
      ? false
      : storyHasVoiceoverLines

  // Создать Video с output configuration
  const video = await prisma.video.create({
    data: {
      scenarioId: body.scenarioId,
      variantId: acceptedVariant.id,
      applicationId: scenario.appId,
      format: format as "portrait" | "landscape",
      status: "pending",
      subtitlesEnabled: body.subtitlesEnabled ?? true,
      subtitlesStyle: (body.subtitlesStyle || undefined) as never,
      musicEnabled: body.musicEnabled ?? true,
      musicMood: body.musicMood || null,
      musicDuration: body.musicDuration || null,
      musicVolume: typeof body.musicVolume === 'number' ? Math.max(0, Math.min(1, body.musicVolume)) : undefined,
      musicVolumeWithVoiceover: typeof body.musicVolumeWithVoiceover === 'number' ? Math.max(0, Math.min(1, body.musicVolumeWithVoiceover)) : undefined,
      clipDuration: Math.min(15, Math.max(3, body.clipDuration || 5)),
      imageCount: effectiveImageCount,
      renderQuality,
      targetPlatform: body.targetPlatform || null,
      imageModelId: body.imageModelId || "fal-ai/flux/dev",
      videoModelId: body.videoModelId || "fal-ai/kling-video/v3/standard/text-to-video",
      modelStrategy: body.modelStrategy || 'auto',
      generateAudio: body.generateAudio ?? true,
      // Voiceover
      voiceoverEnabled: resolvedVoiceoverEnabled,
      voiceoverModelId: body.voiceoverModelId || null,
      voiceoverVoiceId: body.voiceoverVoiceId || null,
      voiceoverLanguage: body.voiceoverLanguage || 'en',
      voiceoverPacing: body.voiceoverPacing || 'moderate',
      voiceoverReconciliation: body.voiceoverReconciliation || 'compress_audio',
      lipSyncEnabled: body.lipSyncEnabled === true,
      lipSyncModelId: body.lipSyncModelId || null,
    },
  })

  // Fire-and-forget запуск пайплайна
  runVideoPipeline(video.id).catch(() => {})

  return {
    data: {
      id: video.id,
      status: video.status,
      format: video.format,
      subtitlesEnabled: video.subtitlesEnabled,
      musicEnabled: video.musicEnabled,
      musicMood: video.musicMood,
      renderQuality: video.renderQuality,
      targetPlatform: video.targetPlatform,
      storyDriven: isStoryDriven,
      sceneCount: isStoryDriven ? storySceneCount : effectiveImageCount,
      voiceoverEnabled: video.voiceoverEnabled,
      voiceoverModelId: video.voiceoverModelId,
      voiceoverWarning: (body.voiceoverEnabled && !storyHasVoiceoverLines)
        ? 'StoryPlan не содержит voiceover lines — озвучка будет пропущена'
        : null,
    },
  }
})
