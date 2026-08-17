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
import { normalizeSceneClips } from "./render"
import { TIMELINE_FPS } from "~~/shared/types/video-runtime"
import { estimateVideoCost } from "./video-cost"
import { getModel, getDefaultImageModel, getDefaultVideoModel } from "./video-models"
import type { StoryPlan } from "~~/shared/types/story"
import { normalizeSubtitleStyle } from "./subtitle-style"
import { buildStoryVideoPlan } from "./story-video-planner"
import { selectScenarioVariantForVideo, describeVariantSelection } from "./scenario-variant-selection"

import {
  type PromptGenerationResult,
  type StepKey,
  STEP_ORDER,
  acquireLock,
  releaseLock,
  forceReleaseLock,
  updateVideoStatus,
  ensureStep,
  updateStep,
} from "./video-pipeline-db"

import {
  runPromptGeneration,
  runImageGeneration,
  runClipGeneration,
  runVoiceoverGeneration,
  runAudioFirstVoiceover,
  runVideoTranscription,
  runMusicGeneration,
  runAssembly,
  hasAudioFirstTrack,
  loadEnrichmentContext,
  type VoiceoverStepResult,
} from "./video-pipeline-steps"
import { planSceneKinds } from "./broll-plan"

import { runLipSyncStep, type LipSyncAudioFirstInput } from "./lip-sync-runner"
import type { AlignedScene } from "./transcription/align"
import { isTranscriptionRouteAvailable } from "./transcription/media-task"

import { throwIfAborted, CancellationError } from "./pipeline-cancel-registry"

import { logStepCost } from "./balance/cost-ledger"

import { recommendModels, type ModelStrategy } from "./video-models"
import { StorageKeys } from "./storage/keys"
import { uploadLocalAsset } from "./storage/persist-asset"
import { storageKeyToLegacyUrl } from "./storage/download-to-storage"

import { isFalAccessBlocking, isFalProbeInconclusive } from "./fal-access-gate"
import { cancelReplicatePredictionsForVideo } from "./replicate/cancel"
import { getAssetsDirFor } from "./storage-paths"
import {
  assetTypesForSteps,
  createAssetFileRemovalDeps,
  removeAssetFiles,
  STEP_RERUN_RESET_PATCH,
} from "./video-pipeline-reset"
import {
  accumulateStepCost,
  computeClipActualCost,
  computeImageActualCost,
  imageMegapixels,
  stepAttemptForLedger,
} from "./video-cost-actual"
import { estimateMediaCost, findMediaSpec } from "./media-provider/registry"
import { mapStepKeyToService, type CostService } from "./balance/cost-attribution"
import {
  clipVolumeWithVoiceoverFor,
  didLipSyncProduceNewClips,
  executionOrderFor,
  generatedUnitsFromAssetDelta,
  shouldApplyVoiceoverClipPaths,
  snapshotInvalidationPatch,
  stepsInvalidatedByFreshClips,
  stepsToRerunFrom,
} from "./video-pipeline-run-policy"

/**
 * Порядок, в котором оркестратор ведёт прогон КОНКРЕТНОГО ролика.
 *
 * Тонкая обёртка над `executionOrderFor`: маршрут — свойство ролика
 * (`Video.editPipeline`), а не глобальный флаг, и весь пайплайн обязан читать
 * его из одного места. По этому же порядку считается каскад перезапуска шага,
 * поэтому расходиться им нельзя.
 */
export function planPipelineRun(editPipeline: boolean): readonly StepKey[] {
  return executionOrderFor(editPipeline)
}

/**
 * Маршрут, по которому ролик пойдёт НА САМОМ ДЕЛЕ.
 *
 * Флага на ролике мало: audio-first держится на транскрипции, и без модели для
 * неё маршрут неисполним. Решение принимается ДО первой оплаты (см.
 * runVideoPipeline) и по этому же правилу считается каскад перезапуска шага:
 * сбрасывать шаги чужого порядка нельзя.
 *
 * Деградация на прежний маршрут допустима ТОЛЬКО пока ролик не начали собирать
 * от звука. Начатый ролик менять маршрут не имеет права: единый трек уже
 * оплачен, клипы и аватарные кадры синхронизированы под него, а прежний шаг
 * озвучки его кэш не узнает (он ищет `mixedPath`) — синтез оплатится второй раз
 * и ляжет под готовые губы ДРУГИМ звуком, причём ролик получит статус «готов».
 * Поэтому здесь честное падение, а не тихий переход.
 */
async function resolveVideoRoute(videoId: number, editPipeline: boolean): Promise<boolean> {
  if (!editPipeline) return false
  if (isTranscriptionRouteAvailable()) return true

  if (await hasAudioFirstTrack(videoId)) {
    throw new Error(
      `Видео ${videoId} собрано от звука (единый трек уже синтезирован), но модель транскрипции отключена: `
      + `включите MEDIA_MODEL_TRANSCRIPTION или пересоберите ролик с нуля`,
    )
  }
  return false
}

/**
 * Номер попытки шага на текущий момент (0 — шаг ещё ни разу не стартовал).
 * Нужен, чтобы отличить «шаг отработал и заплатил» от «шаг вернул готовое с
 * прошлого прогона»: attemptCount растёт только в первом случае.
 */
async function loadStepAttempt(videoId: number, stepKey: StepKey): Promise<number> {
  const step = await prisma.videoGenerationStep.findFirst({
    where: { videoId, stepKey: stepKey as never },
    select: { attemptCount: true },
  })
  return step?.attemptCount ?? 0
}

/**
 * Записывает деньги, потраченные шагом в ЭТОМ прогоне: копит actualCost шага и
 * кладёт строку в ledger с номером попытки (разные попытки — разные списания).
 */
async function chargeStep(
  videoId: number,
  stepKey: StepKey,
  service: CostService,
  modelId: string | null,
  runCost: number,
): Promise<void> {
  const step = await prisma.videoGenerationStep.findFirst({
    where: { videoId, stepKey: stepKey as never },
  })
  if (!step) return

  // accumulate, а не перезапись: прогон, который ничего не генерировал, не
  // должен стирать из отчёта уже потраченное на предыдущей попытке.
  await updateStep(step.id, { actualCost: accumulateStepCost(step.actualCost, runCost) })
  await logStepCost(
    step.id, stepKey, service, runCost, videoId, modelId,
    { attempt: stepAttemptForLedger(step.attemptCount) },
  )
}

/**
 * Сервис, которому ушли деньги за кадр или клип. Берётся из спеки модели, а не
 * литералом "fal.ai": после перевода этих способностей на Replicate литерал
 * писал бы чужой расход на счётчик fal.
 */
function mediaServiceFor(modelId: string | null): CostService {
  return mapStepKeyToService("image_generation", modelId) ?? "fal.ai"
}

/** Сколько ассетов данного типа уже лежит у ролика — база для дельты «сгенерировано за прогон». */
async function countVideoAssets(videoId: number, type: "image" | "clip"): Promise<number> {
  return prisma.videoAsset.count({ where: { videoId, type: type as never } })
}

/**
 * Списывает то, что упавший шаг успел сгенерировать до сбоя.
 *
 * Число единиц восстанавливаем по приросту VideoAsset: сам шаг при исключении
 * generatedCount не возвращает, и раньше деньги упавшей попытки не попадали в
 * ledger вообще — ни на этом прогоне, ни на следующем (resume считает только
 * собственную дельту), из-за чего burn-rate занижался на каждом частичном сбое.
 *
 * Ничего не бросает: причина сбоя шага важнее, чем учёт, и подменять исходное
 * исключение ошибкой БД нельзя.
 */
async function chargePartialStepOnFailure(
  videoId: number,
  assetType: "image" | "clip",
  assetsBefore: number,
  charge: (generatedCount: number) => Promise<void>,
): Promise<void> {
  try {
    const generated = generatedUnitsFromAssetDelta(assetsBefore, await countVideoAssets(videoId, assetType))
    if (generated > 0) await charge(generated)
  } catch { /* учёт не должен подменять причину падения шага */ }
}

/**
 * Обесценивает кэш шагов, чей результат посчитан от файлов клипов, после того как
 * lip-sync подменил эти файлы в текущем прогоне.
 *
 * Зачем: снапшот озвучки хранит не только clipPaths, но и voiceover_mix — сведённый
 * по таймлайну ТЕХ клипов (политика extend_scene удлиняет клип и сдвигает старты
 * всех последующих реплик). Отказаться от одних clipPaths мало: микс из кэша
 * ложился на свежие lip-sync клипы другой длительности, и звук уезжал от картинки.
 *
 * Сброс — тем же патчем, что и у rerunVideoStep, но БЕЗ сноса ассетов: реплики
 * сцен (VideoAsset type=voiceover) шаг переиспользует по ветке existingAsset и
 * платит за TTS ноль, а микс он перезапишет по тому же пути и в тот же ассет.
 * Пересобираются ровно тайминги и микс — то, что и обесценили новые клипы.
 *
 * Трогаем только completed-шаги: ранний возврат кэша срабатывает лишь на них,
 * а сбрасывать в pending живой/упавший шаг незачем.
 *
 * Вызывается только когда единый трек НЕ состоялся (старый маршрут либо
 * audio-first без синтезированного трека) — единственный колл-сайт стоит под
 * `!audioFirstTrackCompleted` (см. комментарий там). В обоих случаях шаг
 * озвучки, чей кэш здесь обесценивают, один и тот же — посценный
 * `runVoiceoverGeneration`, поэтому параметра editPipeline у этой функции нет.
 */
async function invalidateClipDerivedStepCaches(
  videoId: number,
  lipSyncProducedNewClips: boolean,
): Promise<void> {
  const steps = stepsInvalidatedByFreshClips(lipSyncProducedNewClips)
  if (steps.length === 0) return

  const reset = await prisma.videoGenerationStep.updateMany({
    where: {
      videoId,
      stepKey: { in: steps as never[] },
      status: "completed" as never,
    },
    data: snapshotInvalidationPatch(STEP_RERUN_RESET_PATCH) as never,
  })

  if (reset.count > 0) {
    await logAgent('video-pipeline', 'info',
      `Video ${videoId}: lip-sync выдал новые клипы — кэш шагов ${steps.join(', ')} сброшен `
      + `(${reset.count}), микс и тайминги озвучки будут пересобраны на свежих клипах`,
      { videoId },
    ).catch(() => {})
  }
}

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
  // Токен владения держим в локальной переменной прогона: глобальная карта по
  // videoId приводила к тому, что finally отменённого прогона снимал блокировку
  // уже с нового запуска (и по ролику крутились два пайплайна сразу).
  const lockHandle = await acquireLock(videoId)
  if (!lockHandle) {
    throw new Error(`Pipeline для видео ${videoId} уже запущен`)
  }

  try {
    // ── Cancel checkpoint #1: до загрузки данных ──
    throwIfAborted(signal)

    // 1. Загрузить Video + Scenario + ВСЕ варианты.
    // Грузим все, а не только accepted: выбор варианта делает общее правило
    // selectScenarioVariantForVideo (selectedVariantId → accepted → первый по
    // variantIndex). Раньше здесь брался accepted, а при его отсутствии первый
    // по variantIndex с принудительным акцептом — и выбор оператора терялся.
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        scenario: {
          include: {
            variants: { orderBy: { variantIndex: "asc" } },
          },
        },
      },
    })

    if (!video || !video.scenario) {
      throw new Error(`Видео ${videoId} или связанный сценарий не найден`)
    }

    const { scenario } = video
    const variantChoice = selectScenarioVariantForVideo(scenario.variants, scenario.selectedVariantId)
    if (!variantChoice) {
      throw new Error(`У сценария ${scenario.id} нет вариантов для генерации видео`)
    }
    const variant = variantChoice.variant

    // Авто-акцепт только когда вариант взят как первый по порядку (автономный
    // прогон без человека). Готовый выбор оператора или критика не переписываем.
    if (variantChoice.needsAutoAccept) {
      await prisma.scenarioVariant.update({
        where: { id: variant.id },
        data: { status: "accepted" as never },
      })
      await prisma.scenario.update({
        where: { id: scenario.id },
        data: { selectedVariantId: variant.id },
      })
    }
    if (variantChoice.ignoredSelectedReason) {
      await logAgent('video-pipeline', 'warn',
        `Видео ${videoId}: ${describeVariantSelection(variantChoice)}`,
        { videoId },
      ).catch(() => {})
    }

    // Model strategy — применяется ДО валидации, может переопределить дефолтные ID.
    // Если user выбрал strategy ≠ 'auto' и оставил DB-дефолты — подставляем recommendModels().
    // Дефолт берётся из реестра спек, а не литералом: ровно то, что записал в
    // Video эндпоинт запуска. Литеральная копия здесь молча ломала подстановку
    // стратегии, как только основной провайдер сменился (P1-17).
    const DEFAULT_IMG = getDefaultImageModel().id
    const DEFAULT_VID = getDefaultVideoModel().id
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

    // Валим запуск только на однозначных вердиктах (нет ключа / доступ закрыт).
    // probe_error — сбой самой проверки, а не приговор модели: из-за сетевого
    // сбоя терять прогон нельзя, реальный submit вернёт внятную ошибку сам.
    // Семантика идентична preflight'у в pipeline-executors.ts (общий fal-access-gate).
    if (imgAccess && isFalAccessBlocking(imgAccess.status)) {
      throw new Error(
        `Нет доступа к модели изображений "${imgModel.name}" (${effectiveImageModelId}): ${imgAccess.reason}. `
        + `Статус: ${imgAccess.status}. Проверьте план/workspace вашего аккаунта fal.ai.`,
      )
    }
    if (imgAccess && isFalProbeInconclusive(imgAccess.status)) {
      await logAgent('video-pipeline', 'warn',
        `Preflight модели изображений "${imgModel.name}" (${effectiveImageModelId}) не дал вердикта: `
        + `${imgAccess.reason} (статус ${imgAccess.status}). Продолжаем — доступ проверит сам submit.`,
        { videoId },
      ).catch(() => {})
    }
    if (vidAccess && isFalAccessBlocking(vidAccess.status)) {
      throw new Error(
        `Нет доступа к модели видео "${vidModel.name}" (${effectiveVideoModelId}): ${vidAccess.reason}. `
        + `Статус: ${vidAccess.status}. Проверьте план/workspace вашего аккаунта fal.ai.`,
      )
    }
    if (vidAccess && isFalProbeInconclusive(vidAccess.status)) {
      await logAgent('video-pipeline', 'warn',
        `Preflight модели видео "${vidModel.name}" (${effectiveVideoModelId}) не дал вердикта: `
        + `${vidAccess.reason} (статус ${vidAccess.status}). Продолжаем — доступ проверит сам submit.`,
        { videoId },
      ).catch(() => {})
    }
    if (ttsAccess && isFalAccessBlocking(ttsAccess.status)) {
      throw new Error(
        `Нет доступа к TTS модели "${effectiveTtsModelId}": ${ttsAccess.reason}. `
        + `Отключите voiceover или выберите другую модель.`,
      )
    }
    if (ttsAccess && isFalProbeInconclusive(ttsAccess.status)) {
      await logAgent('video-pipeline', 'warn',
        `Preflight TTS модели "${effectiveTtsModelId}" не дал вердикта: `
        + `${ttsAccess.reason} (статус ${ttsAccess.status}). Продолжаем — доступ проверит сам submit.`,
        { videoId },
      ).catch(() => {})
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

    // Раскладка на говорящую голову и перебивки. Перебивка снимается кадром с
    // движением камеры вместо покупки клипа: девятисекундная сцена дешевеет с
    // $0.41 до стоимости одного кадра ($0.025). Решение от 14.08.2026, см.
    // docs/superpowers/specs/2026-08-14-avatar-pipeline.md §8.
    //
    // Считается ДО шага изображений: перебивке нужен кадр, а по умолчанию
    // кадры пропускаются как промежуточный артефакт. Теперь они материал сцены.
    const brollScenePlan = videoPlan.mode !== 'legacy_simple'
      ? planSceneKinds({
        scenes: videoPlan.scenes.map((scene, index) => ({
          order: index,
          durationSec: scene.durationSec,
          spokenLine: presenterSceneIndexes.has(index) ? scene.spokenLine ?? "presenter" : null,
        })),
      })
      : null
    const brollEnabled = process.env.BROLL_STILL_SCENES_ENABLED !== "false"
    const needsBrollImages = brollEnabled && (brollScenePlan?.needsImages.length ?? 0) > 0
    if (needsBrollImages) {
      videoPlan.skipImageGeneration = false
    }
    /** Сцены, которые смета не должна считать как платный text-to-video. */
    const brollEstimateIndexes = new Set(needsBrollImages ? brollScenePlan!.needsImages : [])

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
      // Из сметы клипов уходят и сцены ведущей, и перебивки: первые собирает
      // lip-sync, вторые — кадр с движением камеры. Платный text-to-video
      // остаётся только там, где сцена не попала ни в то, ни в другое.
      perSceneDurations: videoPlan.mode !== 'legacy_simple'
        ? videoPlan.scenes
          .filter((_, index) => !presenterSceneIndexes.has(index) && !brollEstimateIndexes.has(index))
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

    // Попытка шага ДО прогона: runner инкрементит attemptCount только когда
    // реально идёт в провайдера, а при resume отдаёт готовый outputSnapshot.
    // Разница «до/после» — единственный честный признак того, что этот прогон
    // за шаг заплатил (для промптов и музыки счётчика сгенерированного нет).
    const promptAttemptBefore = await loadStepAttempt(videoId, "prompt_generation")

    // 2. Генерация промптов (с полным story context).
    // Ролику из живых сцен рисовать нечего — визуальные промпты никто не прочтёт,
    // а сам шаг это ещё и платный вызов LLM на каждую сцену.
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
    // Actual cost: prompt generation — только если LLM реально дёргали в этом
    // прогоне. Пропущенный шаг ведущей attemptCount не трогает, поэтому
    // отдельная проверка на presenterOnly не нужна: разница «до/после» уже нулевая.
    if ((await loadStepAttempt(videoId, "prompt_generation")) > promptAttemptBefore) {
      await chargeStep(videoId, "prompt_generation", "anthropic", null, prompts.scenePrompts ? 0.02 : 0.01)
    }

    // ── 2b. Маршрут «монтаж от звука»: озвучка и транскрипция ДО картинки ──
    //
    // Порядок здесь не косметика: на этом маршруте звук — эталон времени, и
    // границы слов из транскрипции задают, какой длины снимать каждый кадр.
    // Ролик, который идёт прежним маршрутом, через этот блок не проходит вовсе:
    // у него порядок вызовов остаётся прежним (planPipelineRun(false)).
    let audioFirstTrack: Awaited<ReturnType<typeof runAudioFirstVoiceover>> | null = null
    let audioFirst: LipSyncAudioFirstInput | null = null
    /** Сцены с фактическими границами слов. На audio-first без них шаг падает. */
    let alignedScenes: readonly AlignedScene[] = []

    /**
     * Маршрут ролика решается ЗДЕСЬ и ДО первой оплаты.
     *
     * Транскрипция на audio-first не опция, а условие сборки: без границ слов
     * lip-sync пропускает каждую сцену ведущего, своих клипов у них нет, и
     * «собранный» ролик оказывается склейкой перебивок под непрерывную речь.
     * Поэтому ролик, которому транскрипция недоступна в принципе (модель не
     * настроена) и который от звука ещё не собирали, уходит прежним маршрутом
     * ЦЕЛИКОМ — ни трек, ни куски, ни аватарные кадры не оплачены впустую.
     * Ролик, у которого трек уже есть, вместо этого честно падает (см.
     * resolveVideoRoute).
     */
    const audioFirstRoute = await resolveVideoRoute(videoId, video.editPipeline)
    if (video.editPipeline && !audioFirstRoute) {
      await logAgent('video-pipeline', 'warn',
        `Video ${videoId}: EDIT_PIPELINE включён, но модель транскрипции не настроена `
        + `(MEDIA_MODEL_TRANSCRIPTION) — ролик идёт прежним маршрутом целиком, единый трек не синтезируется`,
        { videoId },
      ).catch(() => {})
    }

    if (audioFirstRoute) {
      // ── Cancel checkpoint: до платного синтеза трека ──
      throwIfAborted(signal)
      audioFirstTrack = await runAudioFirstVoiceover(
        videoId,
        {
          voiceoverEnabled: video.voiceoverEnabled,
          voiceoverModelId: effectiveTtsModelId,
          voiceoverVoiceId: video.voiceoverVoiceId,
          voiceoverLanguage: video.voiceoverLanguage,
          voiceoverPacing: (video.voiceoverPacing as 'slow' | 'moderate' | 'fast') || 'moderate',
          lipSyncCharacterId: video.lipSyncCharacterId,
        },
        videoPlan,
      )

      if (audioFirstTrack.status === 'completed' && audioFirstTrack.trackPath && audioFirstTrack.trackFingerprint) {
        // ── Cancel checkpoint: до транскрипции ──
        throwIfAborted(signal)
        // Границ не будет — шаг бросит, и прогон честно упадёт: ролик без сцен
        // ведущего не должен получить статус «готов».
        const transcription = await runVideoTranscription({
          videoId,
          track: {
            path: audioFirstTrack.trackPath,
            fingerprint: audioFirstTrack.trackFingerprint,
            storageKey: audioFirstTrack.storageKey,
          },
          scenes: audioFirstTrack.scenes,
          language: video.voiceoverLanguage,
        })
        alignedScenes = transcription.scenes

        audioFirst = {
          trackPath: audioFirstTrack.trackPath,
          trackDurationSec: audioFirstTrack.durationSec,
          // Отпечаток ФИНАЛЬНОГО файла — того, из которого lip-sync и режет
          // куски. Считай мы его по треку до вставки пауз, ключи сцен
          // относились бы к одному файлу, а звук брался из другого.
          trackFingerprint: audioFirstTrack.trackFingerprint,
          scenes: alignedScenes,
          // fps ролика, а не дефолт шага: к этой же сетке нормализация
          // притягивает каждый клип перед склейкой (TIMELINE_FPS).
          fps: TIMELINE_FPS,
        }

        if (transcription.status === 'degraded') {
          await logAgent('video-pipeline', 'warn',
            `Video ${videoId}: выравнивание сошлось частично (${transcription.warning ?? 'без пояснения'}) — `
            + `границы сцен приблизительные, монтаж по ним всё равно точнее плановых длительностей`,
            { videoId },
          ).catch(() => {})
        }
      } else {
        // Речи в ролике нет вовсе (нет StoryPlan либо ни реплик в кадре, ни
        // закадровых строк): единый трек собирать не из чего, выравнивать нечего
        // и синхронизировать lip-sync тоже нечего. Прогон идёт дальше прежним
        // шагом озвучки — на таком ролике он сам пропустится.
        await logAgent('video-pipeline', 'warn',
          `Video ${videoId}: единый трек не синтезирован (${audioFirstTrack.reason ?? 'причина не указана'}) — `
          + `речи для него в сценарии нет, прогон продолжается прежним шагом озвучки`,
          { videoId },
        ).catch(() => {})
      }
    }

    /**
     * ФАКТ — трек синтезирован и готов, а не «маршрут выбран».
     *
     * `audioFirstRoute` решает, ПЫТАЕМСЯ ли мы собрать единый трек (флаг +
     * доступна транскрипция); он не меняется задним числом и остаётся истиной
     * для порядка шагов и каскада перезапуска. Но синтез мог не состояться
     * (`legacy_mode_no_single_track`, `empty_script` — см. ветку `else` выше) —
     * тогда всё, что описывает ПОВЕДЕНИЕ сборки и озвучки (подгон длин, громкость
     * дорожек клипов, сброс кэша), обязано смотреть на этот факт, а не на
     * `audioFirstRoute`: иначе ролик получает выключенное сведение длин и
     * заглушенные в ноль дорожки клипов без единого трека, который их заменяет
     * (spec §6.4) — ведущего не слышно вовсе.
     */
    const audioFirstTrackCompleted = audioFirstTrack?.status === 'completed'

    // 3. Генерация изображений — story-driven может пропустить этот шаг
    const effectiveImageCount = videoPlan.mode !== 'legacy_simple'
      ? videoPlan.scenes.length
      : (video.imageCount ?? 3)

    // ── Cancel checkpoint #4: до генерации изображений ──
    throwIfAborted(signal)

    // Считаем ассеты ДО шага: если шаг упадёт на середине, только по их приросту
    // и можно восстановить, сколько картинок провайдер уже выставил в счёт.
    const imageAssetsBefore = await countVideoAssets(videoId, "image")
    // Спека модели решает, в чём считать: fal берёт за мегапиксель, Replicate —
    // за кадр. Умножать «за кадр» на мегапиксели значило бы завысить вертикальный
    // кадр вдвое, поэтому единицу выбирает биллинг спеки, а не вызывающий.
    const imageSpec = findMediaSpec(effectiveImageModelId)
    const chargeImages = async (generatedCount: number) => {
      // Actual cost: images — платим за то, что сгенерировано В ЭТОМ прогоне.
      // Картинки, поднятые с диска после resume, провайдеру повторно не оплачены.
      // Сервис берётся из спеки модели: маршрут может вести и на Replicate.
      const runCost = generatedCount <= 0
        ? 0
        : imageSpec
          ? estimateMediaCost(imageSpec, {
            images: generatedCount,
            megapixels: generatedCount * imageMegapixels(video.format, video.renderQuality),
          })
          : computeImageActualCost({
            generatedCount,
            format: video.format,
            renderQuality: video.renderQuality,
            pricePerMegapixel: imgModel.pricing.base,
          })
      await chargeStep(videoId, "image_generation", mediaServiceFor(effectiveImageModelId), effectiveImageModelId, runCost)
    }

    let imgResult: Awaited<ReturnType<typeof runImageGeneration>>
    try {
      // Ролик из живых фрагментов ведущей не рисует ни одного кадра, включая превью.
      imgResult = presenterOnly
        ? await skipImageGenerationStep(videoId)
        : await runImageGeneration(
          videoId, prompts, video.format, effectiveImageCount,
          effectiveImageModelId, video.renderQuality, videoPlan,
        )
    } catch (stepError) {
      // Упавшая попытка тоже оставляет свою строку в ledger — картинки,
      // скачанные до сбоя, провайдер уже выставил в счёт.
      await chargePartialStepOnFailure(videoId, "image", imageAssetsBefore, chargeImages)
      throw stepError
    }
    await chargeImages(imgResult.generatedCount)

    // ── Cancel checkpoint #5: до генерации клипов ──
    throwIfAborted(signal)

    // 4. Генерация клипов — per-scene duration из videoPlan
    // Actual cost: clips — по числу реально сгенерированных клипов, а не по числу
    // сцен: после resume часть клипов берётся с диска и повторно не оплачена,
    // а сцены ведущей вообще не уходят в text-to-video.
    const clipPricePerSec = (video.generateAudio && vidModel.pricing.withAudio)
      ? vidModel.pricing.withAudio
      : vidModel.pricing.base
    const clipAssetsBefore = await countVideoAssets(videoId, "clip")
    const chargeClips = async (generatedCount: number) => {
      await chargeStep(videoId, "clip_generation", mediaServiceFor(effectiveVideoModelId), effectiveVideoModelId, computeClipActualCost({
        scenes: videoPlan.mode !== 'legacy_simple'
          ? videoPlan.scenes.filter((_, index) => !presenterSceneIndexes.has(index))
          : [],
        generatedCount,
        pricePerSecond: clipPricePerSec,
        fallbackDurationSec: video.clipDuration,
      }))
    }

    // Кадры под перебивки: карта «индекс сцены → файл кадра». Сцена, кадра под
    // которую нет, снимается прежним путём, а не остаётся без картинки.
    const imagePathsByScene = new Map<number, string>()
    if (needsBrollImages) {
      imgResult.imagePaths.forEach((path, index) => {
        if (path) imagePathsByScene.set(index, path)
      })
    }
    const brollSceneIndexes = new Set(
      (brollScenePlan?.needsImages ?? []).filter(index => imagePathsByScene.has(index)),
    )

    let clipResult: Awaited<ReturnType<typeof runClipGeneration>>
    try {
      clipResult = await runClipGeneration(
        videoId, prompts, video.format, video.clipDuration,
        effectiveVideoModelId, video.generateAudio, videoPlan,
        variant.storyPlan as StoryPlan | null,
        presenterSceneIndexes,
        brollSceneIndexes,
        imagePathsByScene,
      )
    } catch (stepError) {
      // Клипы — самый дорогой шаг: три скачанных Kling-клипа из упавшего прогона
      // это ~$1, и терять их в отчёте нельзя.
      await chargePartialStepOnFailure(videoId, "clip", clipAssetsBefore, chargeClips)
      throw stepError
    }
    const clipPaths = clipResult.clipPaths
    await chargeClips(clipResult.generatedCount)

    // Порядок нарезки клипов задаёт МОДЕЛЬ: runClipGeneration идёт по
    // prompts.scenePrompts.scenes и нигде их не сортирует, поэтому clipPaths[i] —
    // это клип сцены scenePrompts.scenes[i].order, а не сцены videoPlan.scenes[i].
    // Прокидываем порядок явно во все шаги, которые сопоставляют сцены с клипами:
    // чтение снапшота prompt_generation остаётся у них фолбэком для вызовов не из
    // полного прогона, а снапшота может не быть вовсе.
    const clipSceneOrders = prompts.scenePrompts?.scenes?.map(s => s.order)

    // 4b. Lip-sync (премиум) — заменяет клипы scene-by-scene на lip-synced, если фича включена.
    // Идёт между clip_generation и voiceover_generation, чтобы дальнейшие шаги работали с
    // уже sync-нутыми клипами; voiceover здесь — это off-screen narrator, отдельный поток.
    // ── Cancel checkpoint #6: до lip-sync ──
    throwIfAborted(signal)

    let effectiveClipPaths = clipPaths
    const lipSyncAttemptBefore = await loadStepAttempt(videoId, "lip_sync_generation")
    const lipSyncResult = await runLipSyncStep({
      videoId,
      clipPaths,
      videoPlan,
      clipSceneOrders,
      // null на старом маршруте — шаг работает ровно как раньше, посценным синтезом.
      audioFirst,
      videoConfig: {
        lipSyncEnabled: video.lipSyncEnabled,
        lipSyncModelId: video.lipSyncModelId,
        lipSyncCharacterId: video.lipSyncCharacterId,
        voiceoverModelId: effectiveTtsModelId,
        voiceoverVoiceId: video.voiceoverVoiceId,
        voiceoverLanguage: video.voiceoverLanguage,
        voiceoverPacing: (video.voiceoverPacing as 'slow' | 'moderate' | 'fast') || 'moderate',
        format: video.format === 'landscape' ? 'landscape' : 'portrait',
      },
    })
    if (lipSyncResult.status === 'completed' && lipSyncResult.clipPaths.length > 0) {
      effectiveClipPaths = lipSyncResult.clipPaths
    }
    // Появились ли у lip-sync НОВЫЕ файлы клипов — от этого зависит, можно ли
    // доверять путям клипов из кэша озвучки. Считаем по факту (сколько сцен реально
    // ушло в провайдер), а не по приросту attemptCount: шаг увеличивает счётчик и
    // когда всё переиспользовал из снапшота, и по этому признаку оркестратор
    // выбрасывал удлинённые (extend_scene) клипы, из-за чего звук уезжал от картинки.
    // Прирост попытки остаётся фолбэком для снапшотов старого формата.
    const lipSyncAttemptGrew = (await loadStepAttempt(videoId, "lip_sync_generation")) > lipSyncAttemptBefore
    const lipSyncProducedNewClips = didLipSyncProduceNewClips(lipSyncResult, lipSyncAttemptGrew)

    // Приведение клипов к единому кодеку/fps/таймбазе — ДО озвучки, а не внутри
    // сборки. Нормализация режет по границе кадра и укорачивает клип на
    // 0.02-0.06 с; пока её делала сборка, шаг озвучки строил таймлайн по
    // ИСХОДНЫМ файлам, ошибка копилась от сцены к сцене, и на ролике 24 к
    // восьмой сцене реплика заезжала в следующий тейк на 0.18 с. Теперь все
    // шаги меряют ровно те файлы, которые попадут в склейку. Повторный вызов в
    // сборке бесплатен: нормализованный путь она узнаёт и пропускает.
    effectiveClipPaths = await normalizeSceneClips(
      effectiveClipPaths,
      video.format === 'landscape' ? 'landscape' : 'portrait',
    )

    // Свежие файлы губ обесценивают кэш озвучки ЦЕЛИКОМ: её микс сведён по
    // длительностям клипов прошлого прогона. Сбрасываем ДО вызова шага, иначе он
    // вернёт снапшот с чужим таймлайном и в сборку уедет разъехавшийся звук.
    //
    // На audio-first сброса НЕТ и быть не может: там кэш озвучки — это единый
    // оплаченный трек, посчитанный не от клипов, а наоборот. Выбросив его, мы
    // синтезировали бы другой звук (у TTS нет seed) и обесценили бы каждый уже
    // снятый аватарный кадр ролика (§4.4). Смотрим на ФАКТ, а не на выбранный
    // маршрут: ролик с включённым флагом, но без единого трека (нет модели
    // транскрипции — либо модель есть, а трек не состоялся, empty_script/
    // legacy_mode_no_single_track) идёт прежним шагом озвучки, и кэш ему
    // сбрасывать надо ровно как раньше.
    if (!audioFirstTrackCompleted && video.voiceoverEnabled) {
      await invalidateClipDerivedStepCaches(videoId, lipSyncProducedNewClips)
    }

    // ── Cancel checkpoint #7: до voiceover ──
    throwIfAborted(signal)

    // 5. Voiceover (TTS) — идёт ПЕРЕД music чтобы cost/ducking были известны заранее
    let voiceoverResult: VoiceoverStepResult
    // Проверка по свойству, а не по `audioFirstTrackCompleted`: TS сужает тип
    // `audioFirstTrack` до non-null только по прямой проверке, а он нужен ниже
    // как объект.
    if (audioFirstTrack && audioFirstTrack.status === 'completed') {
      // На audio-first речь уже синтезирована ДО картинки, шаг озвучки здесь
      // отработал и оплачен. Переносим его результат в форму, которую ждут
      // сборка и итоговый лог: сцен в нём нет — трек единый и не режется на
      // реплики, а `clipPaths` отсутствуют, потому что подгонять клипы под
      // звук этому маршруту не нужно.
      voiceoverResult = {
        status: 'completed',
        mixedPath: audioFirstTrack.trackPath,
        mixedDurationSec: audioFirstTrack.durationSec,
        sceneResults: [],
        totalCostUsd: audioFirstTrack.totalCostUsd,
        provider: null,
        modelId: audioFirstTrack.modelId,
        voiceId: audioFirstTrack.voiceId,
      }
    } else {
      const voiceoverAttemptBefore = await loadStepAttempt(videoId, "voiceover_generation")
      voiceoverResult = await runVoiceoverGeneration(
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
          // ФАКТ трека, а не выбранный маршрут: мы уже внутри ветки, где трек не
          // состоялся (см. `if` выше), — если audio-first не состоялся, шаг
          // обязан вести себя ровно как на прежнем маршруте.
          editPipeline: audioFirstTrackCompleted,
        },
        videoPlan,
        clipSceneOrders,
      )

      // Политика extend_scene могла удлинить клипы — дальше собираем из обновлённых
      // файлов, иначе в сборку уедут исходные (короткие) клипы и озвучка обрежется.
      // Но кэшу озвучки доверяем не всегда: её outputSnapshot хранит пути клипов
      // ТОГО прогона, и если lip-sync только что переигрался, старые *_ext.mp4
      // выбросили бы свежий (оплаченный) результат губ.
      const voiceoverRegenerated = (await loadStepAttempt(videoId, "voiceover_generation")) > voiceoverAttemptBefore
      if (voiceoverResult.clipPaths) {
        if (shouldApplyVoiceoverClipPaths({ voiceoverRegenerated, lipSyncProducedNewClips })) {
          effectiveClipPaths = voiceoverResult.clipPaths
        } else {
          await logAgent('video-pipeline', 'warn',
            `Video ${videoId}: клипы из кэша озвучки не применены — lip-sync выдал новые файлы в этом прогоне, `
            + `удлинённые файлы относятся к прошлым клипам`,
            { videoId },
          ).catch(() => {})
        }
      }
    }

    // ── Cancel checkpoint #8: до музыки ──
    throwIfAborted(signal)

    // 6. Музыка
    const musicAttemptBefore = await loadStepAttempt(videoId, "music_generation")
    const musicPath = await runMusicGeneration(
      videoId,
      video.musicEnabled,
      video.musicMood,
      video.musicDuration,
      videoPlan,
    )
    if (musicPath) {
      const musicModel = getModel("mubert")
      // Трек, поднятый из outputSnapshot при resume, Mubert повторно не выставляет:
      // признак реальной генерации — выросший attemptCount.
      if (musicModel && (await loadStepAttempt(videoId, "music_generation")) > musicAttemptBefore) {
        await chargeStep(videoId, "music_generation", "mubert", "mubert", musicModel.pricing.base)
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
    //
    // Считает их сам шаг озвучки — по длительностям клипов, которые он измерил,
    // сводя микс. Раньше оркестратор пересчитывал их сам, складывая ПЛАНОВЫЕ
    // длительности сцен, а план у ролика 23 ставил всем девяти по 10 секунд: звук
    // клипов приглушался не там, где идёт речь. Снапшоты, записанные до этой
    // правки, поля не знают — тогда интервалов нет вовсе и сборка глушит клипы на
    // всём ролике, как делала всегда; выдумывать их из плана нельзя.
    const voiceoverIntervals = voiceoverResult.voicedIntervals ?? []

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
        // Родная дорожка клипа глушится в ноль только когда единый трек ДЕЙСТВИТЕЛЬНО
        // состоялся — тогда она тот же кусок трека, что уже звучит на 1.0 из
        // voiceoverPath, и 0.3 дали бы двойную речь с эхом (spec §6.4). Без
        // состоявшегося трека (старый маршрут либо audio-first, где трек не
        // синтезировался) заменить эту дорожку нечем — прежние 0.3 сохраняются,
        // иначе ведущего не было бы слышно вовсе.
        clipVolumeWithVoiceover: clipVolumeWithVoiceoverFor(audioFirstTrackCompleted),
        subtitlePreset: (video.subtitlePreset as import('./render').SubtitlePresetId | null) ?? undefined,
        subtitleStyleOverride,
        clipSceneOrders,
        voiceoverIntervals: voiceoverIntervals.length > 0 ? voiceoverIntervals : undefined,
        // Границы слов из транскрипции. Сегодня сборка только фиксирует их в
        // логе шага, субтитры по ним рисует следующая задача плана — но данные
        // обязаны доезжать сюда уже сейчас, иначе доказать сквозной проход
        // маршрута нечем.
        alignedScenes: alignedScenes.length > 0 ? alignedScenes : undefined,
        // Верхняя граница подгона длины последнего клипа под трек (Task 10) —
        // только когда трек СОСТОЯЛСЯ: без него alignedScenes уже пуст (см.
        // выше), и подгон не запустится независимо от этого значения, но факт
        // важнее совпадения — маршрут без трека такой границы не считает.
        voiceoverDurationSec: audioFirstTrackCompleted ? voiceoverResult.mixedDurationSec : undefined,
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
    await releaseLock(lockHandle)
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
): Promise<{ imagePaths: string[], imageRemoteUrls: string[], generatedCount: number }> {
  const step = await ensureStep(videoId, "image_generation", STEP_ORDER.indexOf("image_generation"))
  await updateStep(step.id, {
    status: "skipped",
    finishedAt: new Date(),
    actualCost: 0,
    outputSnapshot: { reason: "presenter_only_video", imagePaths: [], imageRemoteUrls: [], generatedCount: 0 },
  })
  return { imagePaths: [], imageRemoteUrls: [], generatedCount: 0 }
}

/**
 * Перезапустить конкретный шаг генерации видео.
 * Сбрасывает только указанный шаг и все последующие шаги.
 *
 * Вместе со статусами сносит артефакты этих шагов: без этого перезапуск был
 * пустышкой — шаги в начале цикла делают continue, если VideoAsset жив и файл
 * лежит на диске, и оператор получал ровно тот же результат.
 * Объекты в постоянном хранилище не трогаем: ключи детерминированные
 * (videos/{id}/...), новая генерация перезапишет их сама.
 */
export async function rerunVideoStep(videoId: number, stepKey: StepKey): Promise<void> {
  // Каскад считаем по РЕАЛЬНОМУ порядку выполнения, а не по STEP_ORDER (там
  // lip_sync стоит после озвучки ради исторического stepIndex). Иначе перезапуск
  // озвучки заставлял заново оплачивать lip-sync, а перезапуск lip-sync оставлял
  // озвучке кэш с путями клипов прошлого прогона.
  //
  // Порядок берём МАРШРУТОМ РОЛИКА: на audio-first озвучка идёт до клипов, и
  // каскад по старому порядку сбросил бы совсем другие шаги — например, оставил
  // бы транскрипт от выброшенного трека. Маршрут тот же, что выберет сам прогон
  // (флаг ролика + исполнимость транскрипции): иначе каскад сбросил бы шаги
  // порядка, по которому ролик всё равно не пойдёт.
  const routed = await prisma.video.findUnique({
    where: { id: videoId },
    select: { editPipeline: true },
  })
  // Ролик, начатый от звука, при отключённой транскрипции сюда не пройдёт:
  // каскад старого порядка снёс бы оплаченный единый трек (ассет voiceover_mix),
  // оставив шаг транскрипции completed с отпечатком уже несуществующего файла.
  const stepsToReset = stepsToRerunFrom(stepKey, await resolveVideoRoute(videoId, routed?.editPipeline ?? false))
  if (stepsToReset.length === 0) throw new Error(`Неизвестный шаг: ${stepKey}`)

  const assetTypes = assetTypesForSteps(stepsToReset)
  if (assetTypes.length > 0) {
    const assets = await prisma.videoAsset.findMany({
      where: { videoId, type: { in: assetTypes as never[] } },
      select: { id: true, filePath: true },
    })

    if (assets.length > 0) {
      const removal = await removeAssetFiles(
        assets.map(a => a.filePath),
        getAssetsDirFor(videoId),
        createAssetFileRemovalDeps(),
      )
      await prisma.videoAsset.deleteMany({ where: { id: { in: assets.map(a => a.id) } } })
      await logAgent('video-pipeline', 'info',
        `Video ${videoId}: перезапуск с шага ${stepKey} — снесено ${assets.length} ассетов (${assetTypes.join(', ')}), файлов удалено ${removal.removed}, не удалось ${removal.failed}`,
        { videoId },
      ).catch(() => {})
    }
  }

  await prisma.videoGenerationStep.updateMany({
    where: {
      videoId,
      stepKey: { in: stepsToReset as never[] },
    },
    // Патч чистит и fal-трекинг: с сохранённым falRequestId следующий прогон
    // сделал бы reattach к старому remote job и вернул прежний результат.
    data: STEP_RERUN_RESET_PATCH as never,
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
 *
 * Идемпотентна и не бросает на уже терминальных сущностях: её дёргают и из
 * ручки отмены, и каскадом из executor'а по abort-сигналу — второй вызов не
 * должен ронять финализацию.
 */
export async function cancelVideoPipeline(videoId: number): Promise<void> {
  // Replicate живёт в MediaPrediction и до fal-веток отмены не доходил: оператор
  // нажимал «отменить», а lip-sync продолжал считаться и списывать деньги.
  const replicate = await cancelReplicatePredictionsForVideo(videoId)
  if (replicate.canceled > 0 || replicate.failed > 0) {
    await logAgent('video-pipeline', replicate.failed > 0 ? 'warn' : 'info',
      `Video ${videoId}: отмена Replicate — отменено ${replicate.canceled}, не удалось ${replicate.failed}`,
      { videoId },
    ).catch(() => {})
  }

  // Живые шаги без falRequestId раньше оставались в running навсегда: fal-запрос
  // мог ещё не уйти (submit в процессе) или шаг вообще локальный.
  const activeSteps = await prisma.videoGenerationStep.findMany({
    where: {
      videoId,
      status: { in: ["running", "queued"] as never[] },
    },
  })

  const canceledAt = new Date()
  for (const step of activeSteps) {
    if (step.falRequestId && step.falEndpoint) {
      await falCancel(step.falEndpoint, step.falRequestId).catch(() => {})
    }
    // Шаг мог завершиться в гонке с отменой — тогда update по исчезнувшей/чужой
    // записи не повод валить всю отмену.
    await updateStep(step.id, {
      status: "canceled",
      falCanceledAt: step.falRequestId ? canceledAt : null,
      finishedAt: canceledAt,
    }).catch(() => {})
  }

  await prisma.videoGenerationStep.updateMany({
    where: { videoId, status: "pending" as never },
    data: { status: "canceled" as never },
  })

  await updateVideoStatus(videoId, "canceled", {
    finishedAt: canceledAt,
    currentStep: null,
  }).catch(() => {})

  // Снимаем блокировку чужого (ещё живого) прогона осознанно — сам он свою уже
  // не снимет: его токен перестанет совпадать и с реестром, и с lockedAt в БД.
  await forceReleaseLock(videoId)
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
