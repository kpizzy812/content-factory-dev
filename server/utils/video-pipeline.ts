/**
 * Video Pipeline — Main orchestration.
 *
 * Public API:
 * - runVideoPipeline(videoId) — main generation flow
 * - rerunVideoStep(videoId, stepKey) — retry a specific step
 * - cancelVideoPipeline(videoId) — cancel active generation
 * - resumeVideoPipeline(videoId) — resume interrupted generation
 *
 * Step runners, DB helpers, and lock management are in:
 * - video-pipeline-steps.ts (step runners)
 * - video-pipeline-db.ts (DB helpers, lock, fal request)
 */

import { falProbeAccessBatch } from "./fal"
import { estimateVideoCost } from "./video-cost"
import { getModel, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from "./video-models"
import type { StoryPlan } from "~~/shared/types/story"
import { normalizeSubtitleStyle } from "./subtitle-style"
import { buildStoryVideoPlan } from "./story-video-planner"

import {
  type PromptGenerationResult,
  type StepKey,
  STEP_ORDER,
  acquireLock,
  releaseLock,
  updateVideoStatus,
  ensureStep,
  updateStep,
} from "./video-pipeline-db"

import {
  runPromptGeneration,
  runImageGeneration,
  runClipGeneration,
  runVoiceoverGeneration,
  runMusicGeneration,
  runAssembly,
  loadEnrichmentContext,
} from "./video-pipeline-steps"

import { runLipSyncStep } from "./lip-sync-runner"

import { throwIfAborted, CancellationError } from "./pipeline-cancel-registry"

import { logStepCost } from "./balance/cost-ledger"

import { recommendModels, type ModelStrategy } from "./video-models"
import { StorageKeys } from "./storage/keys"
import { uploadLocalAsset } from "./storage/persist-asset"
import { storageKeyToLegacyUrl } from "./storage/download-to-storage"

/**
 * Главная оркестрация генерации видео.
 * Запускается fire-and-forget, обновляет статусы в БД.
 * Поддерживает recovery: пропускает уже выполненные шаги.
 *
 * @param videoId — ID видео в БД.
 * @param options.signal — опциональный AbortSignal для отмены между шагами.
 *   Когда signal aborted, между крупными шагами выбрасывается CancellationError;
 *   catch-блок НЕ переводит видео в failed/timeout, а пробрасывает CancellationError
 *   наверх (executor отвечает за финализацию). Cancel fal.ai jobs идёт через
 *   cascade `cancelVideoPipeline(videoId)` в executor'е (см. pipeline-executors.ts).
 *   Backward-compat: legacy callsites без signal работают как раньше.
 */
export async function runVideoPipeline(
  videoId: number,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const signal = options?.signal
  const locked = await acquireLock(videoId)
  if (!locked) {
    throw new Error(`Pipeline для видео ${videoId} уже запущен`)
  }

  try {
    // ── Cancel checkpoint #1: до загрузки данных ──
    throwIfAborted(signal)

    // 1. Загрузить Video + Scenario + принятый вариант
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        scenario: {
          include: {
            variants: {
              where: { status: "accepted" as never },
              take: 1,
            },
          },
        },
      },
    })

    if (!video || !video.scenario) {
      throw new Error(`Видео ${videoId} или связанный сценарий не найден`)
    }

    const { scenario } = video
    let variant = scenario.variants[0]

    // Fallback: if no accepted variant, try any variant
    if (!variant) {
      const anyVariant = await prisma.scenarioVariant.findFirst({
        where: { scenarioId: scenario.id },
        orderBy: { variantIndex: "asc" },
      })

      if (!anyVariant) {
        throw new Error(`У сценария ${scenario.id} нет вариантов для генерации видео`)
      }

      await prisma.scenarioVariant.update({
        where: { id: anyVariant.id },
        data: { status: "accepted" as never },
      })
      variant = anyVariant
    }

    // Model strategy — применяется ДО валидации, может переопределить дефолтные ID.
    // Если user выбрал strategy ≠ 'auto' и оставил DB-дефолты — подставляем recommendModels().
    const DEFAULT_IMG = DEFAULT_IMAGE_MODEL
    const DEFAULT_VID = DEFAULT_VIDEO_MODEL
    const storyPlanForStrategy = variant.storyPlan as { scenes?: unknown[] } | null
    const storySceneCount = storyPlanForStrategy?.scenes?.length ?? 0
    const strategyFromDb = (video.modelStrategy as ModelStrategy | undefined) ?? 'auto'

    const autoPickRec = recommendModels(strategyFromDb === 'auto'
      ? (video.voiceoverEnabled && storySceneCount >= 3 ? 'story_continuity'
        : storySceneCount >= 3 ? 'balanced'
        : 'fast_draft')
      : strategyFromDb, { language: video.voiceoverLanguage || 'en' })

    const effectiveImageModelId = (video.imageModelId === DEFAULT_IMG && strategyFromDb !== 'auto')
      ? autoPickRec.imageModel.id
      : video.imageModelId
    const effectiveVideoModelId = (video.videoModelId === DEFAULT_VID && strategyFromDb !== 'auto')
      ? autoPickRec.videoModel.id
      : video.videoModelId
    const effectiveTtsModelId = video.voiceoverModelId || autoPickRec.ttsModel?.id || null

    if (effectiveImageModelId !== video.imageModelId || effectiveVideoModelId !== video.videoModelId || (video.voiceoverEnabled && effectiveTtsModelId !== video.voiceoverModelId)) {
      await prisma.video.update({
        where: { id: videoId },
        data: {
          imageModelId: effectiveImageModelId,
          videoModelId: effectiveVideoModelId,
          voiceoverModelId: effectiveTtsModelId,
        },
      })
    }

    // Валидация моделей — defense in depth
    const imgModel = getModel(effectiveImageModelId)
    if (!imgModel || !imgModel.integrated) {
      throw new Error(`Модель изображений "${effectiveImageModelId}" не подключена к системе`)
    }
    const vidModel = getModel(effectiveVideoModelId)
    if (!vidModel || !vidModel.integrated) {
      throw new Error(`Модель видео "${effectiveVideoModelId}" не подключена к системе`)
    }
    if (video.voiceoverEnabled && effectiveTtsModelId) {
      const ttsModel = getModel(effectiveTtsModelId)
      if (!ttsModel || !ttsModel.integrated) {
        throw new Error(`TTS модель "${effectiveTtsModelId}" не подключена к системе (integrated=false)`)
      }
    }

    // Preflight: проверяем реальную доступность моделей для текущего FAL_KEY.
    // Resume-aware: если шаг уже completed/skipped, его модель пробить не нужно
    // (изображение давно сгенерировано — какой смысл валидировать FLUX заново;
    // плюс probe может сам падать transiently и блокировать дальнейшие шаги).
    const doneSteps = await prisma.videoGenerationStep.findMany({
      where: { videoId, status: { in: ["completed", "skipped"] as never[] } },
      select: { stepKey: true },
    })
    const doneStepKeys = new Set(doneSteps.map(s => s.stepKey as string))

    // Ролик, целиком снятый живой ведущей, не трогает fal вообще: ни клипов,
    // ни превью-кадра. Пробивать доступ к моделям, которые не будут вызваны,
    // и падать из-за отсутствующего FAL_KEY — нечестно.
    const storyScenes = (variant.storyPlan as StoryPlan | null)?.scenes ?? []
    const presenterCapable = video.lipSyncEnabled && !!video.lipSyncCharacterId
    const presenterSceneCount = presenterCapable
      ? storyScenes.filter(s => s.spokenLine && s.spokenLine.trim().length > 0).length
      : 0
    const presenterOnly = presenterCapable
      && storyScenes.length > 0
      && presenterSceneCount === storyScenes.length

    // Пробить через fal можно только fal-модель: доступность Replicate проверяет
    // сам prediction-service при первом вызове.
    const needImageProbe = !doneStepKeys.has("image_generation")
      && !presenterOnly
      && effectiveImageModelId.startsWith("fal-ai/")
    const needVideoProbe = !doneStepKeys.has("clip_generation")
      && !presenterOnly
      && effectiveVideoModelId.startsWith("fal-ai/")
    // Пробить через fal можно только fal-модель. Replicate-озвучка сюда не идёт:
    // её доступность проверяет сам prediction-service при первом вызове.
    const needTtsProbe = video.voiceoverEnabled
      && !!effectiveTtsModelId
      && effectiveTtsModelId.startsWith("fal-ai/")
      && !doneStepKeys.has("voiceover_generation")

    const accessCheckTargets: string[] = []
    if (needImageProbe) accessCheckTargets.push(effectiveImageModelId)
    if (needVideoProbe) accessCheckTargets.push(effectiveVideoModelId)
    if (needTtsProbe) accessCheckTargets.push(effectiveTtsModelId!)

    // ── Cancel checkpoint #2: до preflight probe ──
    throwIfAborted(signal)

    const accessResults = accessCheckTargets.length > 0
      ? await falProbeAccessBatch(accessCheckTargets)
      : null
    const imgAccess = needImageProbe ? accessResults?.get(effectiveImageModelId) : null
    const vidAccess = needVideoProbe ? accessResults?.get(effectiveVideoModelId) : null
    const ttsAccess = needTtsProbe ? accessResults?.get(effectiveTtsModelId!) : null

    if (imgAccess && imgAccess.status !== "available") {
      throw new Error(
        `Нет доступа к модели изображений "${imgModel.name}" (${effectiveImageModelId}): ${imgAccess.reason}. `
        + `Статус: ${imgAccess.status}. Проверьте план/workspace вашего аккаунта fal.ai.`,
      )
    }
    if (vidAccess && vidAccess.status !== "available") {
      throw new Error(
        `Нет доступа к модели видео "${vidModel.name}" (${effectiveVideoModelId}): ${vidAccess.reason}. `
        + `Статус: ${vidAccess.status}. Проверьте план/workspace вашего аккаунта fal.ai.`,
      )
    }
    if (ttsAccess && ttsAccess.status !== "available") {
      throw new Error(
        `Нет доступа к TTS модели "${effectiveTtsModelId}": ${ttsAccess.reason}. `
        + `Отключите voiceover или выберите другую модель.`,
      )
    }

    // ── Build Story-Driven Video Plan ──
    const enrichmentContext = await loadEnrichmentContext(scenario, variant)
    const videoPlan = buildStoryVideoPlan({
      storyPlan: variant.storyPlan as StoryPlan | null,
      videoModel: vidModel,
      userImageCount: video.imageCount ?? 3,
      userClipDuration: video.clipDuration,
      accountStyleContext: enrichmentContext.accountStyleContext,
      appContext: enrichmentContext.appContext,
    })

    if (videoPlan.warnings.length > 0) {
      try {
        await logAgent('video-pipeline', 'info', `Video ${videoId} plan warnings`, {
          videoId,
          mode: videoPlan.mode,
          warnings: videoPlan.warnings,
        })
      } catch { /* non-critical */ }
    }

    // Сцены, которые играет живая ведущая. Их клип собирает lip-sync из библиотеки
    // исходников, поэтому платить за text-to-video по ним не нужно ни в оценке,
    // ни в самой генерации. Индекс — позиция в плане, так же адресуют клипы шаги.
    const presenterSceneIndexes = new Set<number>()
    if (video.lipSyncEnabled && video.lipSyncCharacterId && videoPlan.mode !== 'legacy_simple') {
      videoPlan.scenes.forEach((scene, index) => {
        if (scene.spokenLine && scene.spokenLine.trim().length > 0) {
          presenterSceneIndexes.add(index)
        }
      })
    }

    // Cost estimation — записываем estimate перед запуском
    const qualityMap: Record<string, "720p" | "1080p"> = { low: "720p", medium: "1080p", high: "1080p" }
    const effectiveSceneCount = videoPlan.mode !== 'legacy_simple'
      ? videoPlan.scenes.length
      : (video.imageCount ?? 3)

    const costConfig = {
      imageModelId: effectiveImageModelId,
      videoModelId: effectiveVideoModelId,
      format: (video.format === "portrait" ? "vertical" : "horizontal") as "vertical" | "horizontal",
      sceneCount: effectiveSceneCount,
      clipDuration: video.clipDuration,
      generateAudio: video.generateAudio,
      enableMusic: video.musicEnabled,
      quality: qualityMap[video.renderQuality] ?? "1080p" as "720p" | "1080p",
      skipImageGeneration: videoPlan.skipImageGeneration,
      perSceneDurations: videoPlan.mode !== 'legacy_simple'
        ? videoPlan.scenes
          .filter((_, index) => !presenterSceneIndexes.has(index))
          .map(s => s.durationSec)
        : undefined,
      // Voiceover config
      voiceoverEnabled: video.voiceoverEnabled,
      voiceoverModelId: effectiveTtsModelId,
      voiceoverLines: video.voiceoverEnabled && videoPlan.mode !== 'legacy_simple'
        ? videoPlan.scenes
          .map(s => s.voiceoverLine?.length ?? 0)
          .filter(len => len > 0)
        : undefined,
      // Lip-sync config — биллинг считает только по сценам с spokenLine
      lipSyncEnabled: video.lipSyncEnabled,
      lipSyncModelId: video.lipSyncModelId,
      lipSyncSceneDurations: video.lipSyncEnabled && videoPlan.mode !== 'legacy_simple'
        ? videoPlan.scenes
          .filter(s => s.spokenLine && s.spokenLine.trim().length > 0)
          .map(s => s.durationSec)
        : undefined,
    }
    const costEstimate = estimateVideoCost(costConfig)
    await prisma.video.update({
      where: { id: videoId },
      data: { totalCostEstimate: costEstimate.total },
    })

    // Записываем estimated cost по шагам
    const stageToStepKey: Record<string, StepKey> = {
      prompts: "prompt_generation",
      images: "image_generation",
      clips: "clip_generation",
      voiceover: "voiceover_generation",
      music: "music_generation",
      lip_sync: "lip_sync_generation",
      assembly: "assembly",
    }
    for (const item of costEstimate.breakdown) {
      const stepKey = stageToStepKey[item.stage]
      if (stepKey) {
        const step = await ensureStep(videoId, stepKey, STEP_ORDER.indexOf(stepKey))
        await updateStep(step.id, { estimatedCost: item.subtotal })
      }
    }

    await updateVideoStatus(videoId, "generating_prompts", {
      startedAt: new Date(),
      currentStep: "prompt_generation",
      variantId: variant.id,
    })

    // ── Cancel checkpoint #3: до генерации промптов ──
    throwIfAborted(signal)

    // 2. Генерация промптов (с полным story context).
    // Ролику из живых сцен рисовать нечего — визуальные промпты никто не прочтёт.
    const prompts = presenterOnly
      ? await skipPromptGenerationStep(videoId, videoPlan.scenes.length)
      : await runPromptGeneration(videoId, variant, videoPlan, {
        favoritePrompts: enrichmentContext.favoritePrompts,
        platform: video.targetPlatform,
        format: video.format as 'portrait' | 'landscape',
        voiceoverLanguage: video.voiceoverLanguage,
        videoModelId: effectiveVideoModelId,
        appId: enrichmentContext.appId,
        socialAccountId: enrichmentContext.socialAccountId,
      })

    // Сохраняем voiceoverPlan и subtitlesStyle из storyPlan в Video.
    // Video.subtitlesStyle — единая точка истины для render и editor; нормализуем
    // структуру сразу при ингесте (clamp wordsPerLine, дефолт 4 если отсутствует).
    // Если у Video уже есть subtitlesStyle (rerun pipeline после ручной правки) —
    // не перезатираем оператора, считаем что он уже принял решение.
    if (variant.storyPlan) {
      const plan = variant.storyPlan as Record<string, unknown>
      const videoUpdate: Record<string, unknown> = {}
      if (plan.voiceoverPlan) videoUpdate.voiceoverPlan = plan.voiceoverPlan
      if (plan.subtitleStyle && !video.subtitlesStyle) {
        videoUpdate.subtitlesStyle = normalizeSubtitleStyle(plan.subtitleStyle) as unknown as object
      }
      if (Object.keys(videoUpdate).length > 0) {
        await prisma.video.update({ where: { id: videoId }, data: videoUpdate as any })
      }
    }
    // Actual cost: prompt generation. Пропущенный шаг ничего не стоил.
    if (!presenterOnly) {
      const promptCost = prompts.scenePrompts ? 0.02 : 0.01
      const promptStep = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "prompt_generation" as never } })
      if (promptStep) {
        await updateStep(promptStep.id, { actualCost: promptCost })
        await logStepCost(promptStep.id, "prompt_generation", "anthropic", promptCost, videoId)
      }
    }

    // 3. Генерация изображений — story-driven может пропустить этот шаг
    const effectiveImageCount = videoPlan.mode !== 'legacy_simple'
      ? videoPlan.scenes.length
      : (video.imageCount ?? 3)

    // ── Cancel checkpoint #4: до генерации изображений ──
    throwIfAborted(signal)

    const imgResult = presenterOnly
      ? await skipImageGenerationStep(videoId)
      : await runImageGeneration(
        videoId, prompts, video.format, effectiveImageCount,
        effectiveImageModelId, video.renderQuality, videoPlan,
      )
    // Actual cost: images
    if (imgResult.imagePaths.length > 0) {
      const isLowQ = video.renderQuality === "low"
      const imgW = video.format === "portrait" ? (isLowQ ? 720 : 1080) : (isLowQ ? 1280 : 1920)
      const imgH = video.format === "portrait" ? (isLowQ ? 1280 : 1920) : (isLowQ ? 720 : 1080)
      const imgMp = Math.ceil((imgW * imgH) / 1_000_000)
      const imageActualCost = imgResult.imagePaths.length * imgMp * imgModel.pricing.base
      const imgStep = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "image_generation" as never } })
      if (imgStep) {
        await updateStep(imgStep.id, { actualCost: imageActualCost })
        await logStepCost(imgStep.id, "image_generation", "fal.ai", imageActualCost, videoId, effectiveImageModelId)
      }
    } else {
      const imgStep = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "image_generation" as never } })
      if (imgStep) await updateStep(imgStep.id, { actualCost: 0 })
      // cost=0 → logStepCost сам skip
    }

    // ── Cancel checkpoint #5: до генерации клипов ──
    throwIfAborted(signal)

    // 4. Генерация клипов — per-scene duration из videoPlan
    const clipPaths = await runClipGeneration(
      videoId, prompts, video.format, video.clipDuration,
      effectiveVideoModelId, video.generateAudio, videoPlan,
      variant.storyPlan as StoryPlan | null,
      presenterSceneIndexes,
    )
    // Actual cost: clips (per-scene duration aware)
    let clipActualCost = 0
    if (videoPlan.mode !== 'legacy_simple') {
      for (const [index, scene] of videoPlan.scenes.entries()) {
        if (presenterSceneIndexes.has(index)) continue
        const pricePerSec = (video.generateAudio && vidModel.pricing.withAudio)
          ? vidModel.pricing.withAudio
          : vidModel.pricing.base
        clipActualCost += scene.durationSec * pricePerSec
      }
    } else {
      const pricePerSec = (video.generateAudio && vidModel.pricing.withAudio)
        ? vidModel.pricing.withAudio
        : vidModel.pricing.base
      clipActualCost = clipPaths.length * video.clipDuration * pricePerSec
    }
    const clipStep = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "clip_generation" as never } })
    if (clipStep) {
      await updateStep(clipStep.id, { actualCost: clipActualCost })
      await logStepCost(clipStep.id, "clip_generation", "fal.ai", clipActualCost, videoId, effectiveVideoModelId)
    }

    // 4b. Lip-sync (премиум) — заменяет клипы scene-by-scene на lip-synced, если фича включена.
    // Идёт между clip_generation и voiceover_generation, чтобы дальнейшие шаги работали с
    // уже sync-нутыми клипами; voiceover здесь — это off-screen narrator, отдельный поток.
    // ── Cancel checkpoint #6: до lip-sync ──
    throwIfAborted(signal)

    let effectiveClipPaths = clipPaths
    const lipSyncResult = await runLipSyncStep({
      videoId,
      clipPaths,
      videoPlan,
      videoConfig: {
        lipSyncEnabled: video.lipSyncEnabled,
        lipSyncModelId: video.lipSyncModelId,
        lipSyncCharacterId: video.lipSyncCharacterId,
        voiceoverModelId: effectiveTtsModelId,
        voiceoverVoiceId: video.voiceoverVoiceId,
        voiceoverLanguage: video.voiceoverLanguage,
        voiceoverPacing: (video.voiceoverPacing as 'slow' | 'moderate' | 'fast') || 'moderate',
      },
    })
    if (lipSyncResult.status === 'completed' && lipSyncResult.clipPaths.length > 0) {
      effectiveClipPaths = lipSyncResult.clipPaths
    }

    // ── Cancel checkpoint #7: до voiceover ──
    throwIfAborted(signal)

    // 5. Voiceover (TTS) — идёт ПЕРЕД music чтобы cost/ducking были известны заранее
    const voiceoverResult = await runVoiceoverGeneration(
      videoId,
      effectiveClipPaths,
      {
        voiceoverEnabled: video.voiceoverEnabled,
        voiceoverModelId: effectiveTtsModelId,
        voiceoverVoiceId: video.voiceoverVoiceId,
        voiceoverLanguage: video.voiceoverLanguage,
        voiceoverPacing: (video.voiceoverPacing as 'slow' | 'moderate' | 'fast') || 'moderate',
        voiceoverReconciliation: (video.voiceoverReconciliation as 'extend_scene' | 'compress_audio' | 'trim_audio') || 'compress_audio',
        modelStrategy: video.modelStrategy || 'auto',
      },
      videoPlan,
    )

    // ── Cancel checkpoint #8: до музыки ──
    throwIfAborted(signal)

    // 6. Музыка
    const musicPath = await runMusicGeneration(
      videoId,
      video.musicEnabled,
      video.musicMood,
      video.musicDuration,
      videoPlan,
    )
    if (musicPath) {
      const musicModel = getModel("mubert")
      const musicStep = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "music_generation" as never } })
      if (musicStep && musicModel) {
        await updateStep(musicStep.id, { actualCost: musicModel.pricing.base })
        await logStepCost(musicStep.id, "music_generation", "mubert", musicModel.pricing.base, videoId, "mubert")
      }
    }

    // 7. Сборка (бесплатно — локальный FFmpeg)
    // subtitleStyleOverride: читаем актуальный Video.subtitlesStyle (мог быть изменён
    // оператором через editor), а не storyPlan — Video — единая точка истины для UI.
    const liveVideo = await prisma.video.findUnique({
      where: { id: videoId },
      select: { subtitlesStyle: true },
    })
    const subtitleStyleOverride = liveVideo?.subtitlesStyle
      ? normalizeSubtitleStyle(liveVideo.subtitlesStyle)
      : null

    // ── Cancel checkpoint #9: до сборки (ffmpeg assembly) ──
    throwIfAborted(signal)

    // Отрезки таймлайна с закадровым голосом. Сцены ведущей сюда не попадают:
    // их звук — это её собственная речь, и глушить его нельзя.
    const voiceoverIntervals: Array<{ startSec: number; endSec: number }> = []
    if (videoPlan.mode !== 'legacy_simple' && voiceoverResult.mixedPath) {
      const voicedScenes = new Map(
        voiceoverResult.sceneResults
          .filter(scene => scene.audioPath && scene.durationSec > 0)
          .map(scene => [scene.sceneOrder, scene.durationSec]),
      )
      let cursorSec = 0
      for (const scene of videoPlan.scenes) {
        const voiceDuration = voicedScenes.get(scene.order)
        if (voiceDuration) {
          voiceoverIntervals.push({
            startSec: cursorSec,
            endSec: cursorSec + Math.min(voiceDuration, scene.durationSec),
          })
        }
        cursorSec += scene.durationSec
      }
    }

    const result = await runAssembly(
      videoId,
      effectiveClipPaths,
      musicPath,
      video.subtitlesEnabled,
      variant.hook,
      variant.cta,
      video.format,
      videoPlan,
      {
        voiceoverPath: voiceoverResult.mixedPath,
        musicVolume: video.musicVolume ?? 0.3,
        musicVolumeWithVoiceover: video.musicVolumeWithVoiceover ?? 0.12,
        clipVolumeWithVoiceover: 0.3,
        subtitlePreset: (video.subtitlePreset as import('./render').SubtitlePresetId | null) ?? undefined,
        subtitleStyleOverride,
        voiceoverIntervals: voiceoverIntervals.length > 0 ? voiceoverIntervals : undefined,
      },
    )
    const assemblyStep = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "assembly" as never } })
    if (assemblyStep) await updateStep(assemblyStep.id, { actualCost: 0 })

    // 7. Суммируем totalCostActual из всех шагов
    const allSteps = await prisma.videoGenerationStep.findMany({
      where: { videoId },
      select: { actualCost: true },
    })
    const totalActual = allSteps.reduce((sum, s) => sum + (s.actualCost ?? 0), 0)

    // ── Cancel checkpoint #10: до финального upload в storage ──
    throwIfAborted(signal)

    // 8. Upload final mp4 в storage и Completed.
    // result.filePath — это локальный /storage путь после ffmpeg assembly,
    // его заливаем в bucket под детерминированным ключом videos/{id}/final.mp4.
    const finalStorage = await uploadLocalAsset(
      result.filePath,
      StorageKeys.videoFinal(videoId),
      "video/mp4",
    )
    await updateVideoStatus(videoId, "completed", {
      filePath: result.filePath,
      fileUrl: storageKeyToLegacyUrl(finalStorage.storageKey),
      duration: result.duration,
      finishedAt: new Date(),
      currentStep: null,
      totalCostActual: totalActual,
      storageKey: finalStorage.storageKey,
      storageProvider: finalStorage.storageProvider,
      fileSizeBytes: finalStorage.fileSizeBytes,
      fileSha256: finalStorage.fileSha256,
    })

    // Дублируем final mp4 как VideoAsset(type=final) для cascade-delete и orphan-scan.
    // Поле type='final' добавлено в enum, но в текущем коде VideoAsset не создаётся
    // для финального видео — keep ассемблер simple, storage cleanup идёт по
    // префиксу videos/{id}/ через deletePrefix.

    try {
      await logAgent('video-pipeline', 'info', `Video ${videoId} completed: ${result.duration}s, cost $${totalActual.toFixed(3)}, mode=${videoPlan.mode}`, {
        videoId,
        runtimeMode: videoPlan.mode,
        storyDriven: videoPlan.mode !== 'legacy_simple',
        sceneCount: videoPlan.mode !== 'legacy_simple' ? videoPlan.scenes.length : 3,
        skippedImages: videoPlan.skipImageGeneration,
        duration: result.duration,
        totalCost: totalActual,
        planWarnings: videoPlan.warnings,
        strategy: strategyFromDb,
        effectiveImageModel: effectiveImageModelId,
        effectiveVideoModel: effectiveVideoModelId,
        voiceover: {
          enabled: video.voiceoverEnabled,
          status: voiceoverResult.status,
          provider: voiceoverResult.provider,
          modelId: voiceoverResult.modelId,
          voiceId: voiceoverResult.voiceId,
          mixedDuration: voiceoverResult.mixedDurationSec,
          sceneCount: voiceoverResult.sceneResults.length,
          reconciled: voiceoverResult.sceneResults.filter(s => s.reconciliation !== 'none' && s.reconciliation !== 'skipped').length,
          totalCost: voiceoverResult.totalCostUsd,
          warnings: voiceoverResult.sceneResults.filter(s => s.warning).map(s => s.warning),
        },
      })
    } catch { /* non-critical */ }
  } catch (error) {
    // ── CancellationError: НЕ помечаем видео как failed/timeout ──
    // Status видео уже выставит cancelVideoPipeline через cascade в executor'е
    // (signal.addEventListener('abort')→cancelVideoPipeline), либо watchdog (B2).
    // Здесь мы только логируем и пробрасываем — чтобы executor увидел отмену
    // и не накапливал launchErrors / не считал видео failed.
    if (error instanceof CancellationError || (error instanceof Error && error.name === 'CancellationError')) {
      try {
        await logAgent('video-pipeline', 'info',
          `Video ${videoId} прерван по cancel signal (между шагами)`,
          { videoId },
        )
      } catch { /* non-critical */ }
      throw error
    }

    const message = error instanceof Error ? error.message : "Неизвестная ошибка"
    const isTimeout = message.includes("таймаут") || message.includes("timeout")

    const videoStatus = isTimeout ? "timeout" : "failed"

    try {
      await logAgent('video-pipeline', isTimeout ? 'warn' : 'error', `Video ${videoId} ${videoStatus}: ${message.slice(0, 500)}`, {
        videoId,
        isTimeout,
      })
    } catch { /* non-critical */ }

    try {
      await prisma.video.update({
        where: { id: videoId },
        data: {
          status: videoStatus as never,
          errorMessage: message.slice(0, 1000),
          finishedAt: new Date(),
        },
      })
    } catch (dbErr) {
      logAgent('video-pipeline', 'error', `Не удалось обновить статус видео ${videoId}: ${dbErr instanceof Error ? dbErr.message : 'unknown'}`, { videoId }).catch(() => {})
    }

    throw error
  } finally {
    await releaseLock(videoId)
  }
}

/**
 * Помечает генерацию визуальных промптов пропущенной. В ролике из живых сцен
 * рисовать нечего, а промпты — это ещё и платный вызов LLM на каждую сцену.
 */
async function skipPromptGenerationStep(
  videoId: number,
  sceneCount: number,
): Promise<PromptGenerationResult> {
  const step = await ensureStep(videoId, "prompt_generation", STEP_ORDER.indexOf("prompt_generation"))
  await updateStep(step.id, {
    status: "skipped",
    finishedAt: new Date(),
    actualCost: 0,
    outputSnapshot: { reason: "presenter_only_video", sceneCount },
  })
  return { hook: '', body: '', cta: '', storySceneCount: sceneCount }
}

/**
 * Помечает генерацию изображений пропущенной: в ролике из живых фрагментов
 * ведущей ни один кадр не рисуется нейросетью, включая превью.
 */
async function skipImageGenerationStep(
  videoId: number,
): Promise<{ imagePaths: string[]; imageRemoteUrls: string[] }> {
  const step = await ensureStep(videoId, "image_generation", STEP_ORDER.indexOf("image_generation"))
  await updateStep(step.id, {
    status: "skipped",
    finishedAt: new Date(),
    actualCost: 0,
    outputSnapshot: { reason: "presenter_only_video", imagePaths: [] },
  })
  return { imagePaths: [], imageRemoteUrls: [] }
}

/**
 * Перезапустить конкретный шаг генерации видео.
 * Сбрасывает только указанный шаг и все последующие шаги.
 */
export async function rerunVideoStep(videoId: number, stepKey: StepKey): Promise<void> {
  const stepIndex = STEP_ORDER.indexOf(stepKey)
  if (stepIndex < 0) throw new Error(`Неизвестный шаг: ${stepKey}`)

  const stepsToReset = STEP_ORDER.slice(stepIndex)
  await prisma.videoGenerationStep.updateMany({
    where: {
      videoId,
      stepKey: { in: stepsToReset as never[] },
    },
    data: {
      status: "pending" as never,
      errorMessage: null,
      finishedAt: null,
      actualCost: null,
    },
  })

  await updateVideoStatus(videoId, "pending", {
    errorMessage: null,
    finishedAt: null,
    filePath: null,
    fileUrl: null,
    totalCostActual: null,
  })

  runVideoPipeline(videoId).catch((err) => {
    logAgent('video-pipeline', 'error', `Ошибка перезапуска шага видео ${videoId}: ${err instanceof Error ? err.message : err}`, { videoId }).catch(() => {})
  })
}

/**
 * Отменить текущую генерацию видео.
 */
export async function cancelVideoPipeline(videoId: number): Promise<void> {
  const activeSteps = await prisma.videoGenerationStep.findMany({
    where: {
      videoId,
      status: { in: ["running", "queued"] as never[] },
      falRequestId: { not: null },
    },
  })

  for (const step of activeSteps) {
    if (step.falRequestId && step.falEndpoint) {
      await falCancel(step.falEndpoint, step.falRequestId).catch(() => {})
    }
    await updateStep(step.id, {
      status: "canceled",
      falCanceledAt: new Date(),
      finishedAt: new Date(),
    })
  }

  await prisma.videoGenerationStep.updateMany({
    where: { videoId, status: "pending" as never },
    data: { status: "canceled" as never },
  })

  await updateVideoStatus(videoId, "canceled", {
    finishedAt: new Date(),
    currentStep: null,
  })

  await releaseLock(videoId)
}

/**
 * Возобновить прерванную генерацию видео.
 * Шаги с falRequestId не теряют связь с remote job — falStepRequest попробует reattach.
 */
export async function resumeVideoPipeline(videoId: number): Promise<void> {
  const video = await prisma.video.findUnique({ where: { id: videoId } })
  if (!video) throw new Error(`Видео ${videoId} не найдено`)

  if (video.status === "completed") {
    throw new Error("Видео уже сгенерировано")
  }

  await prisma.videoGenerationStep.updateMany({
    where: { videoId, status: { in: ["failed", "timeout"] as never[] } },
    data: { status: "pending" as never, errorMessage: null, finishedAt: null },
  })

  await updateVideoStatus(videoId, "pending", {
    errorMessage: null,
    finishedAt: null,
  })

  runVideoPipeline(videoId).catch((err) => {
    logAgent('video-pipeline', 'error', `Ошибка возобновления видео ${videoId}: ${err instanceof Error ? err.message : err}`, { videoId }).catch(() => {})
  })
}
