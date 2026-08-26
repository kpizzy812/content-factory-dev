/**
 * Video Pipeline — Step runners (prompt, image, clip, music, assembly).
 *
 * Extracted from video-pipeline.ts for maintainability.
 * Each function runs one stage of the video generation pipeline.
 */

import { dirname, join } from "node:path"
import type { StoryPlan, SubtitlePlacement, SubtitleStyleProfile } from "~~/shared/types/story"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import {
  planStillSceneDuration,
  VOICE_LEAD_IN_SEC,
  VOICE_TAIL_SEC,
  TIMELINE_FPS,
} from "~~/shared/types/video-runtime"
import type { SceneImagePrompts } from "./video-helpers"
import { type DeviceType, buildDeviceNegativesForScene } from "~~/shared/utils/video-prompt-helpers"
import {
  type StepKey,
  type PromptGenerationResult,
  STEP_ORDER,
  ensureStep,
  updateStep,
  appendStepLog,
  isStepCompleted,
  updateVideoStatus,
} from "./video-pipeline-db"
import { getAccountStyleContext, formatAccountStyleForPrompt } from "./account-style-context"
import { getAppScenarioContext, formatAppContextForPrompt } from "./app-context"
import { synthesizeSpeech, buildVoiceoverTrack, type TtsSynthesisOptions, type TtsSynthesisResult } from "./tts"
import { adjustAudioTempo, trimAudio, probeSceneClipDurations, probeMediaDuration, extendVideoClip, planClipExtension, trimFittedClip, holdLastFrameFittedClip } from "./render"
import { mergeScriptLines } from "./voiceover/script-merge"
import { buildTrackRequest, type TrackPause } from "./voiceover/track-builder"
import { insertVoiceoverPauses } from "./voiceover/insert-pauses"
import { presenterVoiceMissingMessage } from "./presenter/voice-defaults"
import type { AlignedScene, AlignScene } from "./transcription/align"
import { runTranscriptionStep, type TranscriptionStepDeps, type TranscriptionStepResult } from "./transcription/runner"
import { requestTranscription } from "./transcription/media-task"
import { buildSceneClipTimeline, type SceneSubtitleInput } from "./subtitles/scene-timeline"
import {
  alignedScenesMatchPlanPositions,
  buildSceneClipIndexMap,
  compactSceneClipPaths,
  restoreSceneIndexedClipPaths,
} from "./presenter/scene-clip-mapping"
import { getPresetByKey } from "./subtitles/preset-registry"
import { runSubtitleKeywordAgent } from "./agents/subtitle-keyword-agent"
import { pickTtsModel, getModel } from "./video-models"
import { logStepCost } from "./balance/cost-ledger"
import { mapStepKeyToService } from "./balance/cost-attribution"
import { accumulateStepCost, EDIT_PLAN_MODEL_CALL_ESTIMATE_USD, imageMegapixels, stepAttemptForLedger } from "./video-cost-actual"
import { EditPlanUnresolvedError, runEditPlanStep, type EditPlanAppScreenOption, type EditPlanBackgroundOption, type EditPlanModelUsage, type EditPlanStepDeps, type EditPlanStepResult } from "./edit-plan/runner"
import { planEditShots } from "./agents/edit-planner-agent"
import { planShotBackgroundExecution, type PlannedShotRow, type ShotBackgroundAction } from "./edit-plan/shot-background-runner"
import { planShotBackgroundPrompts, type ShotPromptInput, type ShotPromptRequest, type ShotPromptResult } from "./agents/shot-background-prompt-agent"
import { materializeBackgroundClip, materializeAppReference, type ShotMediaDeps, type BackgroundClipRef, type AppReferenceRef } from "./edit-plan/shot-media-store"
import { calculateAnthropicCost } from "./ai-pricing"
import { resolveEditProfile, type ResolvedEditProfile } from "./edit-plan/profile"
import type { PlannedShotWithCost } from "./edit-plan/types"
import { estimateMediaCost, findMediaSpec } from "./media-provider/registry"
import { REPLICATE_KLING_16_DURATIONS, replicateVideoBilling } from "./media-provider/model-specs"
import {
  loadFavoritePromptsForScenario,
  bumpFavoritePromptsUsage,
  type LoadedFavoritePrompt,
} from "./agents/favorite-prompts-loader"
import { resolveMediaRoute } from "./media-provider/registry"
import { runMediaTask } from "./media-provider/run-media-task"
import { planAlignedClipTargets, shouldReconcileVoiceover } from "./video-pipeline-run-policy"
import { renderStillClip } from "./video-tools/still-clip-runner"
import { planShotComposition, mergeUnrenderableShots, type ShotSources } from "./video-tools/shot-compose"
import { renderShotComposition } from "./video-tools/shot-compose-runner"
import { buildTrackSubtitleSegments } from "./edit-plan/shot-subtitles"
import { maxCharsForWidth } from "./subtitles/phrase-chunker"
import type { AssembleOptions } from "./render"
import { readPreviousSceneRecords } from "./presenter/lip-sync-progress"
import { markLipSynced } from "./lip-sync-runner"
import { snapSecToFrame } from "./voiceover/segment-cut"
import { planRemotionOverlays } from "./remotion/overlay-plan"
import { renderRemotionOverlays } from "./remotion/render"
import {
  loadReferenceFrames,
  normalizeSceneReferenceFrame,
  referenceFrameKey,
  type ResolvedReferenceFrame,
  type SceneReferenceFrame,
} from "./media-provider/reference-frame"
import {
  createReferenceFrameDeps,
  materializeReferenceFrame,
} from "./media-provider/reference-frame-repository"
import { StorageKeys } from "./storage/keys"
import { uploadLocalAsset } from "./storage/persist-asset"
import { storageKeyToLegacyUrl } from "./storage/download-to-storage"
import { getStorageDriver } from "./storage"

// ─── Шаг 1: Генерация промптов ─────────────────────────────────

export async function runPromptGeneration(
  videoId: number,
  variant: { hook: string; body: string; cta: string; visualStyleText: string; storyPlan?: unknown },
  videoPlan?: StoryDrivenVideoPlan | null,
  extras?: {
    favoritePrompts?: LoadedFavoritePrompt[]
    platform?: string | null
    format?: 'portrait' | 'landscape'
    voiceoverLanguage?: string | null
    videoModelId?: string
    appId?: number | null
    socialAccountId?: number | null
  },
): Promise<PromptGenerationResult> {
  const step = await ensureStep(videoId, "prompt_generation", 0)

  if (isStepCompleted(step) && step.outputSnapshot) {
    return step.outputSnapshot as unknown as PromptGenerationResult
  }

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: step.attemptCount + 1,
  })
  await updateVideoStatus(videoId, "generating_prompts", { currentStep: "prompt_generation" })

  const storyPlan = variant.storyPlan as StoryPlan | null | undefined
  const isStoryDriven = videoPlan && videoPlan.mode !== 'legacy_simple'

  try {
    let result: PromptGenerationResult
    let promptGenerationDebug: import("./video-prompts/types").PromptGenerationDebug | null = null

    if (isStoryDriven && storyPlan) {
      const sceneCount = videoPlan.scenes.length
      await appendStepLog(step.id, `Story-driven mode (${videoPlan.mode}): ${sceneCount} сцен, генерирую enriched per-scene промпты`)

      if (videoPlan.accountStyleContext) {
        await appendStepLog(step.id, `Account style контекст инжектирован в промпты`)
      }
      if (videoPlan.appContext) {
        await appendStepLog(step.id, `App context инжектирован в промпты`)
      }
      if (videoPlan.negativeConstraints.length > 0) {
        await appendStepLog(step.id, `${videoPlan.negativeConstraints.length} negative constraints применены`)
      }
      const favCount = extras?.favoritePrompts?.length ?? 0
      if (favCount > 0) {
        await appendStepLog(step.id, `${favCount} эталонных промтов инжектировано в Kling контекст`)
      }
      if (extras?.platform) {
        await appendStepLog(step.id, `Platform context: ${extras.platform}${extras.format ? ` (${extras.format})` : ''}`)
      }

      const generated = await generateSceneImagePrompts(storyPlan, videoPlan, extras)
      const scenePrompts = generated.scenes
      promptGenerationDebug = generated.debug

      // Legacy-промпты hook/body/cta в story-driven режиме никто не читает: и
      // картинки, и клипы берут scenePrompts. При этом старый вызов ходит в
      // Anthropic напрямую, мимо общего транспорта, и роняет весь шаг с 401,
      // когда доступ к модели идёт через CLI. Оставляем поля пустыми.
      result = {
        hook: '',
        body: '',
        cta: '',
        scenePrompts,
        storySceneCount: sceneCount,
        runtimeMode: videoPlan.mode,
      }
    } else {
      await appendStepLog(step.id, "Legacy mode: генерирую 3 промпта (hook/body/cta)")

      const prompts = await generateImagePrompts({
        hook: variant.hook,
        body: variant.body,
        cta: variant.cta,
        visualStyle: variant.visualStyleText,
        storyPlan: null,
      })

      result = { ...prompts, runtimeMode: 'legacy_simple' as any }
    }

    // Усекаем rawResponse если > 50KB — защита от лимитов JSONB Postgres.
    const debugForSnapshot = promptGenerationDebug
      ? {
          ...promptGenerationDebug,
          rawResponse: promptGenerationDebug.rawResponse.length > 50_000
            ? promptGenerationDebug.rawResponse.slice(0, 50_000) + "…[truncated]"
            : promptGenerationDebug.rawResponse,
        }
      : null

    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      outputSnapshot: result,
      inputSnapshot: {
        hook: variant.hook.slice(0, 200),
        body: variant.body.slice(0, 200),
        cta: variant.cta.slice(0, 200),
        visualStyle: variant.visualStyleText.slice(0, 200),
        storyDriven: isStoryDriven,
        runtimeMode: result.runtimeMode,
        sceneCount: isStoryDriven ? videoPlan!.scenes.length : 0,
        favoritePromptsCount: extras?.favoritePrompts?.length ?? 0,
        favoritePromptIds: extras?.favoritePrompts?.map(p => p.id) ?? [],
        platform: extras?.platform ?? null,
        format: extras?.format ?? null,
        voiceoverLanguage: extras?.voiceoverLanguage ?? null,
        promptGenerationDebug: debugForSnapshot,
      },
    })
    await appendStepLog(step.id, `Промпты сгенерированы: ${isStoryDriven ? `${videoPlan!.scenes.length} enriched scene-level + legacy fallback` : "3 legacy"}`)

    // Fire-and-forget bump usage (ошибки логируются, не падают)
    const favIds = extras?.favoritePrompts?.map(p => p.id) ?? []
    if (favIds.length > 0) {
      bumpFavoritePromptsUsage(favIds)
        .catch(e => console.warn('[video-pipeline] bumpFavoritePromptsUsage failed', e))
    }

    return result
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Неизвестная ошибка"
    await updateStep(step.id, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: msg.slice(0, 1000),
    })
    await appendStepLog(step.id, `Ошибка: ${msg}`)
    throw error
  }
}

// ─── Шаг 2: Генерация изображений ──────────────────────────────

/** Сцена для генерации изображения. key/order жёстко привязаны к индексу цикла. */
export interface ImageScenePlanItem {
  key: string
  prompt: string
  order: number
  devicesInScene?: DeviceType[]
}

export interface ImageScenePlan {
  scenes: ImageScenePlanItem[]
  /** true — план собран из scenePrompts (story-driven), false — legacy hook/body/cta. */
  storyDriven: boolean
  /** Сколько сцен пришло из промптов до усечения в thumbnail-only. */
  sourceSceneCount: number
  /** order'ы, которые Claude вернул повторно — повод для WARN в логе шага. */
  duplicateOrders: number[]
  /**
   * key'и сцен, для которых сопоставление с планом по order не сработало и пришлось
   * взять сцену плана по позиции. Позиционное совпадение — догадка, поэтому случай
   * логируется отдельно: именно тут AVOID-список может приехать от чужой сцены.
   */
  positionalFallbackKeys: string[]
}

/**
 * Индекс «order → сцена плана» для сопоставления scenePrompts с videoPlan.scenes.
 *
 * В индекс попадают только ОДНОЗНАЧНЫЕ order'ы: если один и тот же order встретился
 * в плане дважды (или это не конечное число), сопоставлять по нему нельзя — обе сцены
 * равноправны, и любой выбор был бы случайным. Такой order выкидывается целиком,
 * вызывающий откатится на позиционный фолбэк и явно это залогирует.
 */
export function indexPlanScenesByOrder<T extends { order: number }>(
  planScenes: readonly T[] | null | undefined,
): Map<number, T> {
  const byOrder = new Map<number, T>()
  const ambiguous = new Set<number>()
  for (const ps of planScenes ?? []) {
    if (!ps || !Number.isFinite(ps.order)) continue
    if (byOrder.has(ps.order)) {
      ambiguous.add(ps.order)
      continue
    }
    byOrder.set(ps.order, ps)
  }
  for (const order of ambiguous) byOrder.delete(order)
  return byOrder
}

/**
 * Строит план генерации изображений. Чистая функция — без БД и сети.
 *
 * ВАЖНО: key и order ассета берутся из ИНДЕКСА ЦИКЛА, а не из scene.order,
 * пришедшего от Claude. Тот же класс бага уже лечили в runClipGeneration: при
 * дубликатах order файлы scene_X_image.png перезаписывали друг друга, а
 * falStepRequest с тем же subKey переиспользовал чужой результат — на выходе
 * одна и та же картинка во всех сценах (и оплаченные впустую генерации).
 *
 * Сцена плана ищется ПО ORDER, а не по позиции: порядок scenePrompts приходит от
 * Claude и нигде не сортируется (см. validateScenes в video-prompts/anthropic-call.ts),
 * так что при перестановке (order'ы 3,1,2) позиция чужая. Раньше здесь был позиционный
 * поиск с «фолбэком» по order, но фолбэк был недостижим — ветка всё равно возвращала
 * planScenes[i] — и в prompt изображения уезжал AVOID-список чужой сцены: устройства
 * и негативы менялись местами.
 *
 * Позиционный фолбэк остаётся только там, где сопоставление по order невозможно
 * (order не число, дублируется в промптах или в плане, либо в плане такого нет).
 * Каждый такой случай попадает в positionalFallbackKeys — шаг пишет об этом WARN.
 */
export function buildImageScenePlan(opts: {
  prompts: PromptGenerationResult
  imageCount: number
  thumbnailOnly: boolean
  planScenes?: Array<{ order: number; devicesInScene?: DeviceType[] }> | null
}): ImageScenePlan {
  const { prompts, imageCount, thumbnailOnly } = opts
  const sp = prompts.scenePrompts?.scenes

  if (sp && sp.length > 0) {
    // В thumbnail-only режиме берём ТОЛЬКО первую сцену (hook).
    const sceneCount = thumbnailOnly ? 1 : sp.length
    const seenOrders = new Set<number>()
    const duplicateOrders: number[] = []
    const positionalFallbackKeys: string[] = []
    const scenes: ImageScenePlanItem[] = []

    const planByOrder = indexPlanScenesByOrder(opts.planScenes)
    const hasPlanScenes = (opts.planScenes?.length ?? 0) > 0
    // Дубликаты order в самих scenePrompts тоже ломают сопоставление: две сцены
    // промпта претендуют на одну сцену плана, и одна из них гарантированно чужая.
    const promptOrderCounts = new Map<number, number>()
    for (let i = 0; i < sceneCount; i++) {
      const order = sp[i]!.order
      if (!Number.isFinite(order)) continue
      promptOrderCounts.set(order, (promptOrderCounts.get(order) ?? 0) + 1)
    }

    for (let i = 0; i < sceneCount; i++) {
      const scene = sp[i]!
      if (seenOrders.has(scene.order)) duplicateOrders.push(scene.order)
      seenOrders.add(scene.order)

      const matchedByOrder = Number.isFinite(scene.order)
        && promptOrderCounts.get(scene.order) === 1
        && planByOrder.has(scene.order)
      const planScene = matchedByOrder ? planByOrder.get(scene.order)! : opts.planScenes?.[i]
      if (!matchedByOrder && hasPlanScenes) {
        positionalFallbackKeys.push(`scene_${i + 1}`)
        console.warn(
          `[buildImageScenePlan] сцена scene_${i + 1}: order=${scene.order} не сопоставился с планом однозначно, беру сцену плана по позиции ${i}`,
        )
      }
      const devices = planScene?.devicesInScene && planScene.devicesInScene.length > 0
        ? [...planScene.devicesInScene]
        : undefined
      // FLUX не имеет negative_prompt — AVOID-список инжектируем в конец prompt.
      const avoidList = buildDeviceNegativesForScene({ devices, hasAppScreenRef: false })
      const finalPrompt = avoidList.length > 0
        ? `${scene.prompt}\n\nAVOID: ${avoidList.join(", ")}`
        : scene.prompt

      scenes.push({
        key: `scene_${i + 1}`,
        prompt: finalPrompt,
        order: i,
        devicesInScene: devices,
      })
    }

    return { scenes, storyDriven: true, sourceSceneCount: sp.length, duplicateOrders, positionalFallbackKeys }
  }

  const cnt = thumbnailOnly ? 1 : imageCount
  const scenes: ImageScenePlanItem[] = []
  for (let i = 0; i < cnt; i++) {
    if (i === 0) {
      scenes.push({ key: "hook", prompt: prompts.hook, order: i })
    } else if (i === cnt - 1) {
      scenes.push({ key: "cta", prompt: prompts.cta, order: i })
    } else {
      scenes.push({ key: `body_${i}`, prompt: prompts.body, order: i })
    }
  }
  return { scenes, storyDriven: false, sourceSceneCount: cnt, duplicateOrders: [], positionalFallbackKeys: [] }
}

export async function runImageGeneration(
  videoId: number,
  prompts: PromptGenerationResult,
  format: string,
  imageCount: number = 3,
  imageModelId: string,
  renderQuality: string,
  videoPlan?: StoryDrivenVideoPlan | null,
): Promise<{ imagePaths: string[]; imageRemoteUrls: string[]; generatedCount: number }> {
  const step = await ensureStep(videoId, "image_generation", 1)

  // Cost-aware: даже в story-driven clip-only режиме генерим МИНИМУМ 1 изображение
  // первой сцены — нужно для preview thumbnail в UI. Раньше тут был полный skip,
  // но user не видел превью видео без главного кадра.
  const thumbnailOnly = videoPlan?.skipImageGeneration === true

  // План строим ДО resume-проверки: только он знает фактическое число сцен.
  // Раньше snapshot сверялся с effectiveImageCount, и при любом расхождении
  // (story-driven расширяет imageCount до числа сцен) шаг перегенерировал ВСЕ
  // изображения заново — платно и без нужды.
  const plan = buildImageScenePlan({
    prompts,
    imageCount,
    thumbnailOnly,
    planScenes: videoPlan?.scenes ?? null,
  })
  const scenes = plan.scenes

  if (isStepCompleted(step) && step.outputSnapshot) {
    const output = step.outputSnapshot as { imagePaths: string[]; imageRemoteUrls?: string[] }
    if (output.imagePaths?.length === scenes.length) {
      return {
        imagePaths: output.imagePaths,
        imageRemoteUrls: output.imageRemoteUrls || [],
        generatedCount: 0,
      }
    }
  }

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: step.attemptCount + 1,
    inputSnapshot: prompts,
  })
  await appendStepLog(step.id, thumbnailOnly
    ? "Story-driven clip-only mode: генерирую 1 thumbnail-изображение для preview"
    : "Начинаю генерацию изображений через fal.ai")
  if (plan.storyDriven && !thumbnailOnly && scenes.length !== imageCount) {
    await appendStepLog(step.id, `Story-driven: ${plan.sourceSceneCount} сцен (imageCount=${imageCount} расширен до ${scenes.length} чтобы не потерять сцены)`)
  }
  if (plan.duplicateOrders.length > 0) {
    await appendStepLog(step.id, `WARN: AI вернул повторяющиеся scene.order (${plan.duplicateOrders.join(", ")}) — ключи сцен взяты по индексу, коллизии файлов не будет`)
  }
  if (plan.positionalFallbackKeys.length > 0) {
    // Сцены плана не сопоставились по order — AVOID-список для этих сцен взят
    // по позиции и может принадлежать соседней сцене. Видно в логе шага.
    await appendStepLog(step.id, `WARN: сцены ${plan.positionalFallbackKeys.join(", ")} не сопоставились с планом по order — devices/AVOID взяты по позиции`)
  }
  await updateVideoStatus(videoId, "generating_images", { currentStep: "image_generation" })

  const assetsDir = getAssetsDir(videoId)
  await ensureDir(assetsDir)

  try {
    const imagePaths: string[] = []
    const imageRemoteUrls: string[] = []
    // Считаем только реально оплаченные генерации: переиспользованные с диска
    // изображения в стоимость шага попадать не должны.
    let generatedCount = 0

    // Маршрут способности разрешается ОДИН раз на шаг: спека несёт и payload,
    // и разбор выхода, и цену. Незнакомой модели в реестре нет по построению —
    // раньше такая уезжала в submit «в формате похожей модели».
    const imageRoute = resolveMediaRoute("text_to_image", imageModelId)

    for (const scene of scenes) {
      await appendStepLog(step.id, `Генерирую изображение для сцены: ${scene.key}`)
      if (scene.devicesInScene && scene.devicesInScene.length > 0) {
        await appendStepLog(step.id, `Сцена ${scene.key}: AVOID device-rules инжектированы (devices: ${scene.devicesInScene.join(", ")})`)
      }

      const existingAsset = await prisma.videoAsset.findFirst({
        where: { videoId, type: "image" as never, order: scene.order },
      })

      if (existingAsset?.filePath) {
        const { access: fsAccess } = await import("node:fs/promises")
        try {
          await fsAccess(existingAsset.filePath)
          imagePaths.push(existingAsset.filePath)
          imageRemoteUrls.push("")
          await appendStepLog(step.id, `Изображение для ${scene.key} уже существует, пропускаю`)
          continue
        } catch {
          // Файл не существует, перегенерируем
        }
      }

      // Ветвления «Replicate идёт своим путём» здесь нет: провайдера выбирает
      // спека маршрута (imageRoute), и runMediaTask сам решает, prediction это
      // или fal-очередь. Размер кадра нормализованный — пересчёт в пропорцию
      // модели лежит в её mapInput.
      const isLowQuality = renderQuality === "low"
      const imageSize = format === "portrait"
        ? { width: isLowQuality ? 720 : 1080, height: isLowQuality ? 1280 : 1920 }
        : { width: isLowQuality ? 1280 : 1920, height: isLowQuality ? 720 : 1080 }

      await appendStepLog(step.id, `Модель: ${imageModelId}, размер: ${imageSize.width}x${imageSize.height}`)

      const imagePath = join(assetsDir, `${scene.key}_image.png`)
      // unitKey=scene.key — прямая замена falSubKey: без него повторные итерации
      // цикла reattach'или бы к результату первой сцены (один step.id хранит
      // один falRequestId).
      const task = await runMediaTask({
        capability: "text_to_image",
        spec: imageRoute.primary,
        fallbackSpec: imageRoute.fallback,
        input: {
          prompt: scene.prompt,
          width: imageSize.width,
          height: imageSize.height,
          count: 1,
        },
        videoId,
        stepId: step.id,
        unitKey: scene.key,
        sceneOrder: scene.order,
        outputPath: imagePath,
        persist: {
          storageKey: StorageKeys.videoSceneImage(videoId, scene.order),
          contentType: "image/png",
        },
      })

      imagePaths.push(task.localPath)
      imageRemoteUrls.push(task.remoteUrl ?? "")
      // generatedCount теперь означает «сколько НОВЫХ ОПЛАЧЕННЫХ задач создали»:
      // результат, вытянутый из нашего же хранилища по ключу идемпотентности,
      // провайдеру второй раз не оплачивается и в стоимость шага не идёт.
      if (task.source === "generated") generatedCount++
      if (task.source === "reused_prediction") {
        await appendStepLog(step.id, `Изображение для ${scene.key} взято из хранилища по уже оплаченной задаче`)
      }

      const imageStorage = task.storage!

      if (existingAsset) {
        await prisma.videoAsset.update({
          where: { id: existingAsset.id },
          data: {
            filePath: imagePath,
            fileUrl: storageKeyToLegacyUrl(imageStorage.storageKey),
            prompt: scene.prompt,
            ...imageStorage,
          },
        })
      } else {
        await prisma.videoAsset.create({
          data: {
            videoId,
            type: "image" as never,
            prompt: scene.prompt,
            filePath: imagePath,
            fileUrl: storageKeyToLegacyUrl(imageStorage.storageKey),
            order: scene.order,
            ...imageStorage,
          },
        })
      }

      await appendStepLog(step.id, `Изображение для ${scene.key} сгенерировано`)
    }

    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      outputSnapshot: { imagePaths, imageRemoteUrls, generatedCount, effectiveImageModel: imageModelId, renderQuality },
    })
    await appendStepLog(step.id, `Все изображения готовы: ${imagePaths.length} шт (сгенерировано в этом прогоне: ${generatedCount})`)

    return { imagePaths, imageRemoteUrls, generatedCount }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Неизвестная ошибка"
    const isTimeout = msg.includes("таймаут") || msg.includes("timeout")
    await updateStep(step.id, {
      status: isTimeout ? "timeout" : "failed",
      finishedAt: new Date(),
      errorMessage: msg.slice(0, 1000),
    })
    await appendStepLog(step.id, isTimeout
      ? `Таймаут генерации изображений (remote job может ещё выполняться): ${msg}`
      : `Ошибка генерации изображений: ${msg}`)
    throw error
  }
}

// ─── Шаг 3: Генерация видеоклипов ──────────────────────────────

/**
 * Итог шага клипов.
 *
 * `clipPaths` адресуется ПОЗИЦИЕЙ СЦЕНЫ в порядке нарезки: длина равна числу сцен,
 * у сцены без собственного клипа (её играет живая ведущая) — пустая ячейка, которую
 * заполняет lip-sync. Раньше список был плотным (6 путей на 9 сцен), а потребители
 * адресовали его индексом сцены — клип одной сцены вставал на место другой, а хвост
 * сцен выпадал с логом «индекс клипа вне списка».
 *
 * generatedCount — сколько клипов реально оплачено В ЭТОМ прогоне.
 */
export interface ClipStepResult {
  clipPaths: string[]
  generatedCount: number
  scenes: Array<{ key: string; order: number; durationSec: number }>
}

export async function runClipGeneration(
  videoId: number,
  prompts: PromptGenerationResult,
  format: string,
  clipDuration: number,
  videoModelId: string,
  generateAudio: boolean,
  videoPlan?: StoryDrivenVideoPlan | null,
  storyPlan?: StoryPlan | null,
  /**
   * Индексы сцен (позиция в videoPlan.scenes), которые снимает живая ведущая.
   * Их клип собирает lip-sync из библиотеки исходников, поэтому платная
   * text-to-video генерация для них не запускается вовсе.
   */
  presenterSceneIndexes?: ReadonlySet<number>,
  /**
   * Сцены-перебивки: снимаются кадром с движением камеры, без платного клипа.
   * Ключ карты кадров — тот же индекс сцены.
   */
  brollSceneIndexes?: ReadonlySet<number>,
  imagePathsByScene?: ReadonlyMap<number, string>,
): Promise<ClipStepResult> {
  const step = await ensureStep(videoId, "clip_generation", 2)

  if (isStepCompleted(step) && step.outputSnapshot) {
    const output = step.outputSnapshot as {
      clipPaths?: string[]
      perSceneDurations?: Array<{ key: string, order?: number, durationSec: number }>
      presenterSceneIndexes?: number[]
    }
    // Пустой массив — законный результат: ролик целиком снят ведущей, генерировать
    // было нечего. Поэтому проверяем сам факт массива, а не его длину.
    if (Array.isArray(output.clipPaths)) {
      const snapshotScenes = output.perSceneDurations ?? []
      // Сколько сцен у ролика на самом деле. Снапшот перечисляет их все (включая
      // отданные ведущей), но у старых записей поля может не быть — тогда считаем
      // по промптам, из которых шаг и нарезает клипы.
      const sceneCount = snapshotScenes.length || prompts.scenePrompts?.scenes?.length || output.clipPaths.length
      // Снапшоты до 15.08.2026 плотные: сцены ведущей в них пропущены. Разворачиваем
      // их обратно по сценам — иначе кэш вернул бы ровно ту раскладку, из-за которой
      // клип одной сцены вставал на место другой.
      const restored = restoreSceneIndexedClipPaths(
        output.clipPaths,
        sceneCount,
        output.presenterSceneIndexes ?? [...(presenterSceneIndexes ?? [])],
      )
      if (restored) {
        // Шаг уже выполнен — новых оплаченных генераций нет.
        return {
          clipPaths: restored,
          generatedCount: 0,
          scenes: snapshotScenes.map((s, idx) => ({
            key: s.key,
            order: s.order ?? idx,
            durationSec: s.durationSec,
          })),
        }
      }
      await appendStepLog(
        step.id,
        `Снапшот шага не раскладывается по сценам (${output.clipPaths.length} путей, `
        + `${snapshotScenes.length} сцен, ${(output.presenterSceneIndexes ?? []).length} у ведущей) — `
        + `пересобираю список; готовые клипы поднимаются с диска и повторно не оплачиваются`,
      )
    }
  }

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: step.attemptCount + 1,
  })

  const isStoryDriven = videoPlan && videoPlan.mode !== 'legacy_simple'
  await appendStepLog(step.id, `Начинаю генерацию видеоклипов через ${videoModelId} (${isStoryDriven ? 'story-driven per-scene duration' : 'legacy uniform duration'})`)
  await updateVideoStatus(videoId, "generating_clips", { currentStep: "clip_generation" })

  let scenes: Array<{
    key: string
    prompt: string
    durationSec: number
    order: number
    referenceFrame?: SceneReferenceFrame | null
    devicesInScene?: DeviceType[]
  }>

  // Pre-load записи опорных кадров сцен. Источник — не только скриншот
  // приложения: тем же маршрутом оживляются портрет ведущего и референс сцены.
  // Если запись удалена — сцена откатится на text-to-video.
  const referenceFramesByKey = new Map<string, ResolvedReferenceFrame>()
  if (isStoryDriven && storyPlan?.scenes?.length) {
    const sceneRefs = storyPlan.scenes
      .map(s => normalizeSceneReferenceFrame(s))
      .filter((x): x is SceneReferenceFrame => !!x)
    if (sceneRefs.length > 0) {
      const loaded = await loadReferenceFrames(sceneRefs, createReferenceFrameDeps())
      for (const [key, frame] of loaded) referenceFramesByKey.set(key, frame)
    }
  }

  if (isStoryDriven && prompts.scenePrompts?.scenes && prompts.scenePrompts.scenes.length > 0) {
    // ВАЖНО: key завязан на индекс цикла, а не на s.order из Claude. Если AI вернул
    // повторяющиеся order'ы, scene_X_clip.mp4 файлы коллизировали бы и переписывали
    // друг друга — на выходе один и тот же ролик. order для DB asset тоже = idx.
    const voiceoverPacing = videoPlan.voiceoverPlan?.pacing ?? 'moderate'
    scenes = prompts.scenePrompts.scenes.map((s, idx) => {
      const planScene = videoPlan.scenes.find(ps => ps.order === s.order)
      const plannedDuration = planScene?.durationSec ?? clipDuration
      // Перебивку рисует ffmpeg из уже оплаченной картинки, и её длину задаём мы:
      // квантование модели (Kling умеет только 5 или 10 секунд) к ней отношения
      // не имеет. Пока это не учитывалось, сцена под реплику на 4.9 с получала
      // десять секунд — пять секунд немого кадра, и субтитр висел после того, как
      // голос замолчал. Платный клип по-прежнему просит плановую длительность.
      const sceneDuration = brollSceneIndexes?.has(idx)
        ? planStillSceneDuration({
          speechText: planScene?.voiceoverLine ?? null,
          pacing: voiceoverPacing,
          plannedSec: plannedDuration,
        })
        : plannedDuration

      // Сопоставление опорного кадра из storyPlan (Claude order соответствует scenePrompt order).
      const storyScene = storyPlan?.scenes?.find(ps => ps.order === s.order)
      const ref = storyScene ? normalizeSceneReferenceFrame(storyScene) : null
      const refRecord = ref ? referenceFramesByKey.get(referenceFrameKey(ref)) : undefined
      // Fallback: если ссылка была задана, но запись референса удалена — забываем
      // привязку и идём text-to-video. WARN остаётся в pipeline log для отладки.
      if (ref && !refRecord) {
        console.warn(`[video-pipeline] Scene ${s.order}: референс ${referenceFrameKey(ref)} не найден, fallback на text-to-video`)
      }

      return {
        key: `scene_${idx + 1}`,
        prompt: s.prompt,
        durationSec: sceneDuration,
        order: idx,
        referenceFrame: ref && refRecord ? ref : null,
        // devicesInScene берём из runtime-плана (не из scenePrompts) — там
        // санитизированный массив, который проложил scene-planner.
        devicesInScene: planScene?.devicesInScene && planScene.devicesInScene.length > 0
          ? [...planScene.devicesInScene]
          : undefined,
      }
    })
    await appendStepLog(step.id, `Per-scene durations: ${scenes.map(s => `${s.key}=${s.durationSec}s`).join(', ')}`)
    // Диагностика разнообразия prompts: логируем первые 100 символов каждого prompt
    // и предупреждаем если хеши совпадают (значит Claude вернул дубликаты).
    const promptHashes = new Set<string>()
    for (const s of scenes) {
      const hash = s.prompt.slice(0, 80).toLowerCase().replace(/\s+/g, ' ')
      promptHashes.add(hash)
      await appendStepLog(step.id, `  [${s.key}] ${s.prompt.slice(0, 140)}${s.prompt.length > 140 ? '…' : ''}`)
    }
    if (promptHashes.size < scenes.length) {
      await appendStepLog(step.id, `WARN: AI вернул дубликаты scene prompts (${promptHashes.size} уникальных из ${scenes.length}). Видео может выйти повторяющимся.`)
    }
  } else {
    const legacyScenes = [
      { key: "hook", prompt: prompts.hook },
      { key: "body", prompt: prompts.body },
      { key: "cta", prompt: prompts.cta },
    ]
    scenes = legacyScenes.map((s, i) => ({
      ...s,
      durationSec: clipDuration,
      order: i,
    }))
  }

  try {
    // Ячейка на КАЖДУЮ сцену: индекс в этом массиве — это позиция сцены в порядке
    // нарезки, и по нему же её ищут lip-sync, озвучка и субтитры. Сцена ведущей
    // остаётся пустой ячейкой — её заполнит lip-sync из библиотеки исходников.
    const clipPaths = new Array<string>(scenes.length).fill("")
    // Только реально сгенерированные (оплаченные) клипы — переиспользованные
    // с диска в стоимость шага попадать не должны.
    let generatedCount = 0

    // Маршрут text-to-video разрешается один раз на шаг. Спека несёт payload,
    // разбор выхода, квантование длительности и цену — ветвления по префиксу
    // id шаг больше не делает.
    const clipRoute = resolveMediaRoute("text_to_video", videoModelId)
    // Маршрут image-to-video тоже приходит из реестра, а не из константы шага.
    // Разрешаем только когда такие сцены есть: ролик без опорных кадров не
    // должен падать из-за чужой настройки MEDIA_MODEL_IMAGE_TO_VIDEO.
    const i2vRoute = scenes.some(s => s.referenceFrame)
      ? resolveMediaRoute("image_to_video")
      : null
    const assetsDir = getAssetsDir(videoId)
    // В story-driven режиме runImageGeneration может быть skipped (skipImageGeneration=true),
    // тогда директория не создаётся. Гарантируем её существование здесь — writeFile в
    // downloadFile падал с ENOENT если parent dir отсутствует.
    await ensureDir(assetsDir)

    // Базовая часть negative_prompt: fal дефолт + hardcoded anti-artifacts +
    // storyPlan.negativeConstraints + continuityBible.forbiddenElements.
    // Per-scene довески (deviceNegatives, app-screen-anchor) добавляются ниже.
    const baseNegativeParts = [
      "blur, distort, low quality",
      "morphing faces, extra limbs, warped hands, sliding feet, floating limbs",
      "text overlay, watermark",
      ...(storyPlan?.negativeConstraints ?? []),
      ...(storyPlan?.continuityBible?.forbiddenElements ?? []),
    ]
    if (storyPlan) {
      await appendStepLog(step.id, `Базовый negative prompt: ${baseNegativeParts.length} элементов (per-scene device-rules добавятся к сценам с устройствами)`)
    }

    const buildNegativePromptForScene = (opts: { devices?: DeviceType[]; hasAppScreenRef: boolean }): string => {
      const sceneNegatives = buildDeviceNegativesForScene({
        devices: opts.devices,
        hasAppScreenRef: opts.hasAppScreenRef,
      })
      const merged = [...baseNegativeParts, ...sceneNegatives].filter(Boolean)
      return [...new Set(merged)].join(", ")
    }

    for (const scene of scenes) {
      if (presenterSceneIndexes?.has(scene.order)) {
        await appendStepLog(step.id, `Сцена ${scene.key}: снимает ведущая, клип соберёт lip-sync — генерацию пропускаю`)
        continue
      }

      const existingClip = await prisma.videoAsset.findFirst({
        where: { videoId, type: "clip" as never, order: scene.order },
      })

      if (existingClip?.filePath) {
        const { access: fsAccess } = await import("node:fs/promises")
        try {
          await fsAccess(existingClip.filePath)
          clipPaths[scene.order] = existingClip.filePath
          await appendStepLog(step.id, `Клип для ${scene.key} уже существует, пропускаю`)
          continue
        } catch {
          // Файл не существует
        }
      }

      // Ветвления «Replicate идёт своим путём» здесь нет: провайдера и модель
      // исполнения выбирает спека маршрута (clipRoute / i2vRoute), а runMediaTask
      // сам решает, prediction это или очередь fal.
      const aspectRatio = format === "portrait" ? "9:16" : "16:9"

      // Image-to-video routing: если сцена привязана к существующему референсу
      // (кадр приложения, портрет ведущего, референс сцены), переключаемся на
      // маршрут способности image_to_video. Удалённая запись обнулила
      // scene.referenceFrame при mapping — fallback на text-to-video, WARN
      // залогирован отдельно. i2vRoute здесь заведомо не null: он разрешается
      // ровно тогда, когда среди сцен есть хоть одна с опорным кадром.
      //
      // Файл опорного кадра готовится ДО выбора маршрута: запись, которую нечем
      // доставить, обязана уронить сцену в text-to-video, а не уйти в платную
      // задачу с пустым входом.
      const referenceFrame = scene.referenceFrame
        ? referenceFramesByKey.get(referenceFrameKey(scene.referenceFrame))
        : undefined
      const referenceFramePath = referenceFrame
        ? await materializeReferenceFrame(referenceFrame, assetsDir)
        : null
      if (referenceFrame && !referenceFramePath) {
        await appendStepLog(
          step.id,
          `Сцена ${scene.key}: файл референса ${referenceFrameKey(referenceFrame)} недоступен — снимаю text-to-video`,
        )
      }
      const useImageToVideo = !!referenceFrame && !!referenceFramePath
      const sceneEndpoint = useImageToVideo ? i2vRoute!.primary.id : videoModelId

      const sceneNegativePrompt = buildNegativePromptForScene({
        devices: scene.devicesInScene,
        // Анкер «не ломай интерфейс» относится только к кадру приложения.
        // Портрету ведущего и референсу сцены он не нужен и вредит.
        hasAppScreenRef: useImageToVideo && referenceFrame!.source === "app_screen",
      })

      if (scene.devicesInScene && scene.devicesInScene.length > 0) {
        await appendStepLog(step.id, `Сцена ${scene.key}: device-orientation negatives применены (devices: ${scene.devicesInScene.join(", ")})`)
      }

      await appendStepLog(step.id, `Генерирую клип: ${scene.key} (${scene.durationSec}s, ${sceneEndpoint}${useImageToVideo ? '' : `, audio: ${generateAudio}`})`)

      const clipPath = join(assetsDir, `${scene.key}_clip.mp4`)
      const clipPersist = {
        storageKey: StorageKeys.videoSceneClip(videoId, scene.order),
        contentType: "video/mp4",
      }

      // Перебивка: сцена без реплики снимается кадром с движением камеры, а не
      // покупкой клипа. Кадр уже оплачен на шаге изображений ($0.025), тогда
      // как text-to-video взял бы $0.045 за каждую секунду. Решение от
      // 14.08.2026, см. docs/superpowers/specs/2026-08-14-avatar-pipeline.md §8.
      const brollImagePath = brollSceneIndexes?.has(scene.order)
        ? imagePathsByScene?.get(scene.order) ?? null
        : null
      if (brollImagePath) {
        await renderStillClip({
          imagePath: brollImagePath,
          outputPath: clipPath,
          durationSec: scene.durationSec,
          sceneIndex: scene.order,
          format: format === "portrait" ? "portrait" : "landscape",
        })
        clipPaths[scene.order] = clipPath
        const brollStorage = await uploadLocalAsset(clipPath, clipPersist.storageKey, clipPersist.contentType)
        await prisma.videoAsset.create({
          data: {
            videoId,
            type: "clip" as never,
            prompt: scene.prompt.slice(0, 500),
            filePath: clipPath,
            fileUrl: storageKeyToLegacyUrl(brollStorage.storageKey),
            order: scene.order,
            duration: scene.durationSec,
            ...brollStorage,
          },
        })
        await appendStepLog(
          step.id,
          `Сцена ${scene.key}: перебивка собрана из кадра движением камеры — платного клипа нет`,
        )
        continue
      }

      // unitKey=scene.key — критично! Без него все 5 клипов получали бы результат
      // первого scene (reattach к одному falRequestId). User потерял $3 на это.
      let task: Awaited<ReturnType<typeof runMediaTask>>
      if (useImageToVideo) {
        await appendStepLog(step.id, `Сцена ${scene.key}: image-to-video через референс ${referenceFrameKey(referenceFrame!)} (${referenceFrame!.source})`)

        // Опорный кадр заливается внутри вызова: в ключ идемпотентности идёт
        // sha256 файла, а не временный URL заливки — иначе каждый прогон
        // считался бы новой задачей и оплачивался заново.
        task = await runMediaTask({
          capability: "image_to_video",
          spec: i2vRoute!.primary,
          fallbackSpec: i2vRoute!.fallback,
          input: {
            prompt: scene.prompt,
            imageUrl: "",
            durationSec: scene.durationSec,
            aspectRatio,
            withAudio: false,
            negativePrompt: sceneNegativePrompt,
          },
          inputUploads: [{ field: "imageUrl", path: referenceFramePath!, contentType: referenceFrame!.mimeType }],
          videoId,
          stepId: step.id,
          unitKey: scene.key,
          sceneOrder: scene.order,
          outputPath: clipPath,
          persist: clipPersist,
        })
        // Длительность после квантования модели известна из спеки: какие
        // значения допустимы, знает она, а не шаг. Реальная длина клипа в
        // timeline не меняется — assemble отрежет по originalDurationSec,
        // поэтому perSceneDurations остаются прежними.
        await appendStepLog(step.id, `Сцена ${scene.key}: i2v duration=${task.effectiveDurationSec}s (исходно ${scene.durationSec}s)`)
      } else {
        task = await runMediaTask({
          capability: "text_to_video",
          spec: clipRoute.primary,
          fallbackSpec: clipRoute.fallback,
          input: {
            prompt: scene.prompt,
            durationSec: scene.durationSec,
            aspectRatio,
            withAudio: generateAudio,
            negativePrompt: sceneNegativePrompt,
          },
          videoId,
          stepId: step.id,
          unitKey: scene.key,
          sceneOrder: scene.order,
          outputPath: clipPath,
          persist: clipPersist,
        })
      }

      clipPaths[scene.order] = task.localPath
      // Только новые оплаченные задачи: клип, вытянутый из нашего хранилища по
      // ключу идемпотентности, второй раз провайдеру не оплачивается.
      if (task.source === "generated") generatedCount++
      if (task.source === "reused_prediction") {
        await appendStepLog(step.id, `Клип для ${scene.key} взят из хранилища по уже оплаченной задаче`)
      }

      const clipStorage = task.storage!

      if (existingClip) {
        await prisma.videoAsset.update({
          where: { id: existingClip.id },
          data: {
            filePath: clipPath,
            fileUrl: storageKeyToLegacyUrl(clipStorage.storageKey),
            duration: scene.durationSec,
            ...clipStorage,
          },
        })
      } else {
        await prisma.videoAsset.create({
          data: {
            videoId,
            type: "clip" as never,
            prompt: scene.prompt,
            filePath: clipPath,
            fileUrl: storageKeyToLegacyUrl(clipStorage.storageKey),
            order: scene.order,
            duration: scene.durationSec,
            ...clipStorage,
          },
        })
      }

      await appendStepLog(step.id, `Клип для ${scene.key} сгенерирован (${scene.durationSec}s)`)
    }

    const sceneSummary = scenes.map(s => ({ key: s.key, order: s.order, durationSec: s.durationSec }))

    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      outputSnapshot: {
        clipPaths,
        generatedCount,
        effectiveVideoModel: videoModelId,
        generateAudio,
        // perSceneDurations держит ВСЕ сцены плана, включая отданные ведущей:
        // по нему сборка и субтитры строят таймлайн, и дыра в нём уехала бы в
        // рассинхрон картинки со звуком.
        perSceneDurations: sceneSummary,
        presenterSceneIndexes: presenterSceneIndexes ? [...presenterSceneIndexes] : [],
      },
    })
    const generatedSeconds = scenes
      .filter(s => !presenterSceneIndexes?.has(s.order))
      .reduce((sum, sc) => sum + sc.durationSec, 0)
    // Считаем заполненные ячейки, а не длину массива: длина теперь всегда равна
    // числу сцен, и «клипов столько же, сколько сцен» перестало бы что-то значить.
    const filledClipCount = clipPaths.filter(p => p.length > 0).length
    await appendStepLog(step.id, presenterSceneIndexes?.size
      ? `Клипы готовы: ${filledClipCount} из ${clipPaths.length} ячеек сцен (${generatedSeconds}s), сгенерировано в этом прогоне ${generatedCount}; ${presenterSceneIndexes.size} сцен отданы ведущей (их ячейки заполнит lip-sync)`
      : `Все клипы готовы: ${filledClipCount} шт, сгенерировано в этом прогоне ${generatedCount} (total: ${generatedSeconds}s)`)

    return { clipPaths, generatedCount, scenes: sceneSummary }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Неизвестная ошибка"
    const isTimeout = msg.includes("таймаут") || msg.includes("timeout")
    // Контекстный лог для DevOps. Raw error body уже залогирован в fetchWithRetry
    // (server/utils/fal.ts) — здесь обогащаем videoId/modelId, чтобы быстро
    // находить failed jobs в Saturn logs. Прецедент: 14.05.2026 баланс fal.ai
    // исчерпан, маркетолог получил "нет доступа к модели" — diagnoses 1.5h не туда.
    console.error("[runClipGeneration] step failed", {
      videoId,
      videoModelId,
      stepId: step.id,
      isTimeout,
      message: msg,
    })
    await updateStep(step.id, {
      status: isTimeout ? "timeout" : "failed",
      finishedAt: new Date(),
      errorMessage: msg.slice(0, 1000),
    })
    await appendStepLog(step.id, isTimeout
      ? `Таймаут генерации клипов (remote job может ещё выполняться): ${msg}`
      : `Ошибка генерации клипов: ${msg}`)
    throw error
  }
}

// ─── Шаг 4a: Генерация voiceover (TTS) ─────────────────────────

/**
 * Результат voiceover step.
 * Содержит путь к смиксованному audio-track, per-scene metadata и reconciliation log.
 */
export interface VoiceoverStepResult {
  status: 'disabled' | 'completed' | 'partial' | 'skipped'
  mixedPath: string | null
  mixedDurationSec: number
  sceneResults: Array<{
    sceneOrder: number
    audioPath: string | null
    durationSec: number
    characters: number
    reconciliation: 'none' | 'sped_up' | 'slowed_down' | 'trimmed' | 'skipped' | 'scene_extended'
    speedFactor?: number
    warning?: string
  }>
  totalCostUsd: number
  provider: string | null
  modelId: string | null
  voiceId: string | null
  /** Обновлённые пути клипов, если политика extend_scene удлинила сцены.
   * Отсутствует, если ничего не менялось — caller делает `clipPaths ?? effectiveClipPaths`. */
  clipPaths?: string[]
  /**
   * Отрезки финального таймлайна, на которых звучит закадровый голос — по
   * ФАКТИЧЕСКОМУ миксу, а не по плану. По ним сборка глушит звук клипов.
   * Отсутствует у снапшотов, записанных до 15.08.2026.
   */
  voicedIntervals?: Array<{ startSec: number; endSec: number }>
}

/**
 * Перепривязывает VideoAsset сцены на удлинённый клип (extend_scene).
 * Заливка в storage тем же способом, что и остальные ассеты — ключ сцены не меняется,
 * чтобы UI и переиздание ролика продолжали видеть актуальный файл.
 */
async function persistExtendedClipAsset(
  videoId: number,
  sceneIndex: number,
  filePath: string,
  durationSec: number,
): Promise<boolean> {
  const asset = await prisma.videoAsset.findFirst({
    where: { videoId, type: "clip" as never, order: sceneIndex },
  })
  if (!asset) return false

  const storage = await uploadLocalAsset(
    filePath,
    StorageKeys.videoSceneClip(videoId, sceneIndex),
    "video/mp4",
  )
  await prisma.videoAsset.update({
    where: { id: asset.id },
    data: {
      filePath,
      fileUrl: storageKeyToLegacyUrl(storage.storageKey),
      duration: Math.round(durationSec),
      ...storage,
    },
  })
  return true
}

export async function runVoiceoverGeneration(
  videoId: number,
  clipPaths: string[],
  videoConfig: {
    voiceoverEnabled: boolean
    voiceoverModelId: string | null
    voiceoverVoiceId: string | null
    voiceoverLanguage: string
    voiceoverPacing: 'slow' | 'moderate' | 'fast'
    voiceoverReconciliation: 'extend_scene' | 'compress_audio' | 'trim_audio'
    modelStrategy: string
    /**
     * ФАКТ — состоялся ли единый трек audio-first, а НЕ выбранный маршрут
     * ролика. Этот шаг (посценная озвучка) вызывается и на audio-first: если
     * трек не синтезировался (`legacy_mode_no_single_track`, `empty_script` —
     * см. `video-pipeline.ts`), речь всё равно синтезирует ОН, а не
     * `runAudioFirstVoiceover`. Поэтому вызывающий обязан передавать сюда
     * `audioFirstTrackCompleted`, а не сырой флаг ролика: перепутав их, шаг
     * получит `true` без трека, который заменил бы его звук, и выключит
     * подгон реплик под клипы там, где он как раз нужен (см.
     * `shouldReconcileVoiceover` — подгон нужен ИМЕННО когда трек не заменил
     * этот шаг).
     *
     * Необязательное: не переданное значение читается как прежний маршрут
     * (посценный), и вызывающие, которые о нём не знают, работают как раньше.
     */
    editPipeline?: boolean
  },
  videoPlan?: StoryDrivenVideoPlan | null,
  /**
   * order'ы сцен в том порядке, в котором реально нарезались клипы
   * (prompts.scenePrompts.scenes). Не передан — сцены сопоставляются с клипами
   * по позиции в плане, как раньше, но об этом пишется предупреждение в лог шага.
   */
  clipSceneOrders?: readonly number[] | null,
): Promise<VoiceoverStepResult> {
  const step = await ensureStep(videoId, "voiceover_generation", 3)

  // 1. Gate: voiceover disabled → skip
  if (!videoConfig.voiceoverEnabled) {
    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
      outputSnapshot: { reason: 'voiceover_disabled_by_config' },
    })
    await appendStepLog(step.id, "Voiceover отключён в конфиге (voiceoverEnabled=false)")
    return {
      status: 'disabled',
      mixedPath: null,
      mixedDurationSec: 0,
      sceneResults: [],
      totalCostUsd: 0,
      provider: null,
      modelId: null,
      voiceId: null,
    }
  }

  // 2. Gate: no story plan или нет voiceoverLine ни в одной сцене → skip
  const isStoryDriven = videoPlan && videoPlan.mode !== 'legacy_simple'
  const voiceoverPlan = videoPlan?.voiceoverPlan
  const planExists = !!voiceoverPlan
  const planEnabled = !!voiceoverPlan?.enabled
  const planLineCount = voiceoverPlan?.lines?.length ?? 0
  const hasVoiceoverLines = planEnabled && planLineCount > 0

  if (!isStoryDriven || !hasVoiceoverLines) {
    // Подробный код причины для UI/логов: видно сразу, на каком гейте упало.
    // user-facing: "озвучка пропущена — план не содержит реплик; перегенерируйте сценарий".
    const reasonCode = !isStoryDriven
      ? 'legacy_mode_no_voiceover'
      : !planExists
          ? 'voiceover_plan_missing'
          : !planEnabled
              ? 'voiceover_plan_disabled'
              : 'voiceover_lines_empty'

    const userMessage = !isStoryDriven
      ? 'Legacy mode (без StoryPlan) — voiceover недоступен'
      : !planExists
          ? 'В сценарии отсутствует voiceoverPlan — перегенерируйте сценарий, чтобы получить план озвучки'
          : !planEnabled
              ? 'voiceoverPlan.enabled=false в сценарии — озвучка отключена на уровне сценария'
              : 'voiceoverPlan.lines пуст — нет реплик для озвучки сцен'

    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
      outputSnapshot: {
        reason: reasonCode,
        userMessage,
        diagnostics: {
          isStoryDriven,
          planExists,
          planEnabled,
          planLineCount,
          videoMode: videoPlan?.mode ?? null,
        },
      },
    })
    await appendStepLog(step.id, `${userMessage} (reason=${reasonCode})`)
    return {
      status: 'skipped',
      mixedPath: null,
      mixedDurationSec: 0,
      sceneResults: [],
      totalCostUsd: 0,
      provider: null,
      modelId: null,
      voiceId: null,
    }
  }

  if (isStepCompleted(step) && step.outputSnapshot) {
    const output = step.outputSnapshot as unknown as VoiceoverStepResult
    if (output.mixedPath) return output
  }

  // Номер попытки нужен ledger'у: rerun шага реально переозвучивает все реплики
  // и провайдер списывает деньги ещё раз — без attempt дедуп cost-ledger склеил бы
  // второе списание с первым и занизил бы траты на TTS (см. cost-ledger.ts).
  const attempt = stepAttemptForLedger(step.attemptCount + 1)
  // Стоимость предыдущих попыток по этому же ролику: actualCost — это деньги,
  // потраченные на шаг целиком, а не за последний прогон.
  const costBefore = step.actualCost

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: attempt,
  })
  await updateVideoStatus(videoId, "generating_voiceover", { currentStep: "voiceover_generation" })

  // 3. Resolve TTS model
  const ttsModel = pickTtsModel({
    language: videoConfig.voiceoverLanguage,
    tier: videoConfig.modelStrategy === 'high_realism' ? 'premium'
      : videoConfig.modelStrategy === 'story_continuity' ? 'standard'
      : 'budget',
    preferredId: videoConfig.voiceoverModelId,
  })

  if (!ttsModel) {
    const msg = 'Нет доступной integrated TTS модели — voiceover невозможен'
    await updateStep(step.id, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: msg,
    })
    await appendStepLog(step.id, msg)
    throw new Error(msg)
  }

  await appendStepLog(step.id, `TTS модель: ${ttsModel.name} (${ttsModel.id}), язык: ${videoConfig.voiceoverLanguage}, pacing: ${videoConfig.voiceoverPacing}`)

  // 4. Build scene timeline из реальных clip durations.
  // Замер по ячейкам сцен: пустая ячейка (сцену снимает ведущая, а lip-sync её не
  // закрыл) обязана остаться дырой. Массовый probeClipDurations превращал её в
  // 5 секунд, и весь хвост реплик уезжал вперёд относительно картинки.
  const clipDurations = clipPaths.length > 0 ? await probeSceneClipDurations(clipPaths) : []
  const scenes = videoPlan!.scenes
  const voiceoverLines = voiceoverPlan!.lines

  // Mapping: sceneOrder → line
  const lineByOrder = new Map<number, typeof voiceoverLines[number]>()
  for (const line of voiceoverLines) lineByOrder.set(line.sceneOrder, line)

  // Клип сцены ищем по ФАКТИЧЕСКОМУ порядку нарезки (prompts.scenePrompts.scenes):
  // этот порядок задаёт модель и совпадать с videoPlan.scenes он не обязан, так что
  // позиция сцены в плане — не индекс её клипа. Раньше было `clipDurations[i]`, и при
  // перестановке сцен озвучка ложилась на чужой клип.
  // Копии массивов — политика extend_scene может удлинить клипы прямо в цикле.
  const clipOrderKnown = !!clipSceneOrders && clipSceneOrders.length > 0
  const clipIndexByOrder = buildSceneClipIndexMap(scenes, clipSceneOrders, {
    allowPositionalFallback: false,
  })
  const effectiveClipDurations = [...clipDurations]
  const effectiveClipPaths = [...clipPaths]
  let clipsExtended = false
  if (!clipOrderKnown) {
    // Деградация, а не молчание: без порядка нарезки сопоставление остаётся
    // позиционным (как раньше) и может уехать, если модель переставила сцены.
    await appendStepLog(step.id, "Порядок нарезки клипов не передан — сцены сопоставлены с клипами по позиции в плане")
  }

  const assetsDir = getAssetsDir(videoId)
  await ensureDir(assetsDir)

  const sceneResults: VoiceoverStepResult['sceneResults'] = []
  // Стартовые времена здесь НЕ храним — только индекс клипа. Политика extend_scene
  // может удлинить клип уже после того, как сцена с бо́льшим индексом клипа прошла
  // цикл (порядок сцен в плане не совпадает с порядком нарезки), поэтому старты
  // считаются один раз после цикла — по финальным длительностям клипов.
  const audiosToMix: Array<{
    sceneOrder: number
    audioPath: string
    clipIndex: number
    voiceoverDurationSec: number
    sceneDurationSec: number
  }> = []
  let totalCost = 0
  let resolvedVoiceId = videoConfig.voiceoverVoiceId

  // 5. Per-scene synthesis + reconciliation
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!
    const line = lineByOrder.get(scene.order)
    // Индекс клипа сцены: по порядку нарезки, а при неизвестном порядке — по позиции.
    const clipIndex = clipOrderKnown ? (clipIndexByOrder.get(scene.order) ?? -1) : i
    // Берём только длительность своего клипа: она от удлинения соседей не зависит.
    // Старт сцены на таймлайне зависит, поэтому вычисляется после цикла.
    const originalClipDurationSec = clipIndex >= 0
      ? (effectiveClipDurations[clipIndex] ?? null)
      : null

    if (!line || !line.text?.trim()) {
      sceneResults.push({
        sceneOrder: scene.order,
        audioPath: null,
        durationSec: 0,
        characters: 0,
        reconciliation: 'skipped',
      })
      await appendStepLog(step.id, `Scene ${scene.order}: нет voiceover text — пропускаю`)
      continue
    }

    if (originalClipDurationSec === null) {
      // Клипа для сцены нет — озвучивать нечего: без клипа реплику некуда положить,
      // а подстановка плановой длительности сдвинула бы весь остальной таймлайн.
      sceneResults.push({
        sceneOrder: scene.order,
        audioPath: null,
        durationSec: 0,
        characters: 0,
        reconciliation: 'skipped',
        warning: `Нет клипа для сцены (индекс клипа ${clipIndex}, клипов всего ${effectiveClipPaths.length}) — озвучка сцены пропущена`,
      })
      await appendStepLog(step.id, `Scene ${scene.order}: клип с индексом ${clipIndex} отсутствует (клипов ${effectiveClipPaths.length} на ${scenes.length} сцен) — озвучку пропускаю`)
      continue
    }
    let sceneDurationSec = originalClipDurationSec

    // Re-use existing asset if present (idempotency)
    const existingAsset = await prisma.videoAsset.findFirst({
      where: { videoId, type: "voiceover" as never, order: scene.order },
    })

    const basePath = join(assetsDir, `voiceover_scene_${scene.order}.mp3`)
    let synthResult: Awaited<ReturnType<typeof synthesizeSpeech>>

    if (existingAsset?.filePath) {
      try {
        const { access: fsAccess } = await import("node:fs/promises")
        await fsAccess(existingAsset.filePath)
        // Re-probe for duration (trusted source)
        const { probeAudioDuration } = await import('./tts')
        const durationSec = await probeAudioDuration(existingAsset.filePath)
        synthResult = {
          audioPath: existingAsset.filePath,
          durationSec,
          model: { id: ttsModel.id, name: ttsModel.name, provider: ttsModel.provider },
          voiceId: resolvedVoiceId ?? '',
          costUsd: 0, // already paid
          remoteUrl: null,
          characters: line.text.length,
        }
        await appendStepLog(step.id, `Scene ${scene.order}: переиспользую existing voiceover (${durationSec}s)`)
      } catch {
        synthResult = await synthesizeSpeech({
          text: line.text,
          outputPath: basePath,
          modelId: ttsModel.id,
          voiceId: resolvedVoiceId,
          language: videoConfig.voiceoverLanguage,
          pacing: videoConfig.voiceoverPacing,
          emotion: line.emotion,
          videoId,
        })
      }
    } else {
      await appendStepLog(step.id, `Scene ${scene.order}: синтезирую voiceover (${line.text.length} симв, emotion=${line.emotion})`)
      synthResult = await synthesizeSpeech({
        text: line.text,
        outputPath: basePath,
        modelId: ttsModel.id,
        voiceId: resolvedVoiceId,
        language: videoConfig.voiceoverLanguage,
        pacing: videoConfig.voiceoverPacing,
        emotion: line.emotion,
        videoId,
      })
    }

    totalCost += synthResult.costUsd
    resolvedVoiceId = synthResult.voiceId

    // 6. Reconciliation
    let finalPath = synthResult.audioPath
    let finalDuration = synthResult.durationSec
    let reconciliation: VoiceoverStepResult['sceneResults'][number]['reconciliation'] = 'none'
    let speedFactor: number | undefined
    let warning: string | undefined

    // Реплика живёт внутри сцены: вдох в начале и хвост в конце. Раньше здесь
    // стоял зазор 0.1 с только с конца, реплика начиналась ровно на стыке клипов
    // и упиралась в следующий — «не успев договорить, стартует новый тейк».
    // Хвост заодно съедает расхождение таймлайнов: сборка склеивает
    // нормализованные клипы, а они короче исходных на несколько сотых.
    const maxAllowedSec = Math.max(0.5, sceneDurationSec - VOICE_LEAD_IN_SEC - VOICE_TAIL_SEC)

    // На audio-first сводить нечего: кадр и так нарезан по границам речи, а
    // подмена клипов файлами `*_ext.mp4` разошлась бы с таймлайном транскрипта.
    // Расхождение длины клипа с речью на этом маршруте закрывает render.ts
    // (fitClipsToTrack/planTrackClipFit) правкой ВИДЕО, а не эта ветка правкой звука.
    if (shouldReconcileVoiceover(videoConfig.editPipeline ?? false)) {
      if (finalDuration > maxAllowedSec) {
        const overshoot = finalDuration - maxAllowedSec
        const requiredSpeed = finalDuration / maxAllowedSec

        // Политика extend_scene: удлиняем СЦЕНУ, а не режем голос. Раньше ветки не было
        // вовсе, и выбор оператора «растянуть сцену» молча работал как compress_audio.
        let resolvedByExtend = false
        if (videoConfig.voiceoverReconciliation === 'extend_scene') {
          const extension = planClipExtension({
            clipDurationSec: sceneDurationSec,
            voiceoverDurationSec: finalDuration,
            gapSec: 0.1,
          })
          const clipPathForScene = effectiveClipPaths[clipIndex]

          if (!clipPathForScene) {
            warning = `Scene ${scene.order}: нет файла клипа для удлинения — деградирую в ускорение/обрезку`
            await appendStepLog(step.id, warning)
          } else if (!extension.allowed) {
            warning = `Scene ${scene.order}: нужно +${extension.neededSec}s, но лимит удлинения ${extension.limitSec}s (max +50% и не более 5s) — деградирую в ускорение/обрезку`
            await appendStepLog(step.id, warning)
          } else {
            try {
              const extPath = clipPathForScene.replace(/\.mp4$/i, '_ext.mp4')
              const extended = await extendVideoClip(clipPathForScene, extPath, extension.neededSec)
              const newDuration = extended.durationSec > 0
                ? extended.durationSec
                : sceneDurationSec + extension.neededSec

              effectiveClipPaths[clipIndex] = extended.outputPath
              effectiveClipDurations[clipIndex] = newDuration
              sceneDurationSec = newDuration
              clipsExtended = true
              resolvedByExtend = true
              reconciliation = 'scene_extended'

              // Ассет клипа лежит под order = индекс клипа (runClipGeneration пишет idx),
              // поэтому перепривязываем именно clipIndex, а не позицию сцены в плане.
              const persisted = await persistExtendedClipAsset(videoId, clipIndex, extended.outputPath, newDuration)
              await appendStepLog(step.id, `Scene ${scene.order}: клип удлинён на +${extension.neededSec}s (было ${originalClipDurationSec}s, стало ${newDuration}s)${persisted ? '' : ' — VideoAsset клипа не найден, обновлён только файл'}`)
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              warning = `Scene ${scene.order}: удлинение клипа не удалось (${msg.slice(0, 160)}) — деградирую в ускорение/обрезку`
              await appendStepLog(step.id, warning)
            }
          }
        }

        if (resolvedByExtend) {
          // Сцена стала длиннее озвучки — ни ускорять, ни резать не нужно.
          await appendStepLog(step.id, `Scene ${scene.order}: озвучка ${finalDuration}s уместилась в удлинённую сцену без ускорения`)
        } else if (videoConfig.voiceoverReconciliation === 'trim_audio') {
          // Политика: обрезать без изменения темпа
          const trimmedPath = join(assetsDir, `voiceover_scene_${scene.order}_trim.mp3`)
          const trimmed = await trimAudio(finalPath, trimmedPath, maxAllowedSec)
          finalPath = trimmed.outputPath
          finalDuration = trimmed.durationSec
          reconciliation = 'trimmed'
          warning = `Voiceover был ${synthResult.durationSec}s, обрезан до ${maxAllowedSec}s (overshoot ${overshoot.toFixed(1)}s)`
        } else if (requiredSpeed <= 1.2) {
          // Ускоряем до 20% — естественно звучит
          const spedPath = join(assetsDir, `voiceover_scene_${scene.order}_sped.mp3`)
          const sped = await adjustAudioTempo(finalPath, spedPath, requiredSpeed)
          finalPath = sped.outputPath
          finalDuration = sped.durationSec
          reconciliation = 'sped_up'
          speedFactor = requiredSpeed
        } else {
          // Сначала ускорение max 1.2, затем trim
          const spedPath = join(assetsDir, `voiceover_scene_${scene.order}_sped.mp3`)
          const sped = await adjustAudioTempo(finalPath, spedPath, 1.2)
          if (sped.durationSec > maxAllowedSec) {
            const trimPath = join(assetsDir, `voiceover_scene_${scene.order}_sped_trim.mp3`)
            const trimmed = await trimAudio(sped.outputPath, trimPath, maxAllowedSec)
            finalPath = trimmed.outputPath
            finalDuration = trimmed.durationSec
            reconciliation = 'trimmed'
            speedFactor = 1.2
            warning = `Voiceover ${synthResult.durationSec}s даже после 1.2x speed не влез в ${maxAllowedSec}s — trim`
          } else {
            finalPath = sped.outputPath
            finalDuration = sped.durationSec
            reconciliation = 'sped_up'
            speedFactor = 1.2
          }
        }
      } else if (finalDuration < maxAllowedSec * 0.6 && videoConfig.voiceoverPacing !== 'slow') {
        // Если озвучка слишком короткая (< 60% сцены) — можно замедлить для naturalism
        const requiredSlow = finalDuration / Math.min(maxAllowedSec * 0.85, finalDuration * 1.2)
        if (requiredSlow < 1.0 && requiredSlow > 0.85) {
          const slowPath = join(assetsDir, `voiceover_scene_${scene.order}_slow.mp3`)
          const slow = await adjustAudioTempo(finalPath, slowPath, requiredSlow)
          finalPath = slow.outputPath
          finalDuration = slow.durationSec
          reconciliation = 'slowed_down'
          speedFactor = requiredSlow
        }
      }
    }

    // Save/update VideoAsset
    const voiceoverStorage = await uploadLocalAsset(
      finalPath,
      StorageKeys.videoVoiceoverLine(videoId, String(scene.order)),
      "audio/mpeg",
    )
    const finalFileUrl = storageKeyToLegacyUrl(voiceoverStorage.storageKey)
    if (existingAsset) {
      await prisma.videoAsset.update({
        where: { id: existingAsset.id },
        data: {
          filePath: finalPath,
          fileUrl: finalFileUrl,
          duration: Math.round(finalDuration),
          prompt: line.text.slice(0, 500),
          ...voiceoverStorage,
        },
      })
    } else {
      await prisma.videoAsset.create({
        data: {
          videoId,
          type: "voiceover" as never,
          prompt: line.text.slice(0, 500),
          filePath: finalPath,
          fileUrl: finalFileUrl,
          order: scene.order,
          duration: Math.round(finalDuration),
          ...voiceoverStorage,
        },
      })
    }

    sceneResults.push({
      sceneOrder: scene.order,
      audioPath: finalPath,
      durationSec: finalDuration,
      characters: synthResult.characters,
      reconciliation,
      speedFactor,
      warning,
    })

    audiosToMix.push({
      sceneOrder: scene.order,
      audioPath: finalPath,
      clipIndex,
      voiceoverDurationSec: finalDuration,
      sceneDurationSec,
    })

    await appendStepLog(step.id, `Scene ${scene.order}: ${finalDuration}s${reconciliation !== 'none' ? ` (${reconciliation}${speedFactor ? ` ${speedFactor.toFixed(2)}x` : ''})` : ''}`)
  }

  if (audiosToMix.length === 0) {
    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      outputSnapshot: {
        status: 'partial',
        mixedPath: null,
        mixedDurationSec: 0,
        sceneResults,
        totalCostUsd: totalCost,
        provider: ttsModel.provider,
        modelId: ttsModel.id,
        voiceId: resolvedVoiceId,
      } as unknown as Record<string, unknown>,
      actualCost: accumulateStepCost(costBefore, totalCost),
    })
    await logStepCost(
      step.id,
      "voiceover_generation",
      mapStepKeyToService("voiceover_generation", ttsModel.id),
      totalCost,
      videoId,
      ttsModel.id,
      { attempt },
    )
    await appendStepLog(step.id, `Voiceover завершился без озвученных сцен (все строки пустые)`)
    return {
      status: 'partial',
      mixedPath: null,
      mixedDurationSec: 0,
      sceneResults,
      totalCostUsd: totalCost,
      provider: ttsModel.provider,
      modelId: ttsModel.id,
      voiceId: resolvedVoiceId,
    }
  }

  // 7. Build combined voiceover track (длительности — уже с учётом extend_scene)
  // Таймлайн строим ОДИН раз и только здесь: к этому моменту все удлинения клипов
  // применены, поэтому старт каждой реплики считается по финальным длительностям.
  // Считай мы старты внутри цикла — сцена, чей клип нарезан позже, но в плане идёт
  // раньше, зафиксировала бы старт до удлинения предыдущего клипа и уехала бы.
  const finalTimeline = buildSceneClipTimeline(
    effectiveClipDurations,
    Math.max(scenes.length, effectiveClipDurations.length),
  )
  const mixScenes = audiosToMix.map(a => {
    const slot = finalTimeline[a.clipIndex]
    return {
      sceneOrder: a.sceneOrder,
      audioPath: a.audioPath,
      // Вдох перед репликой: на самом стыке клипов она наезжала на хвост
      // предыдущего тейка.
      sceneStartSec: (slot?.startSec ?? 0) + VOICE_LEAD_IN_SEC,
      voiceoverDurationSec: a.voiceoverDurationSec,
      sceneDurationSec: slot?.clipDurationSec ?? a.sceneDurationSec,
    }
  })

  /**
   * Где на таймлайне ФАКТИЧЕСКИ звучит закадровый голос.
   *
   * Считается ровно из того, что уходит в микс, и отдаётся наружу: раньше
   * оркестратор строил эти отрезки сам, складывая плановые длительности сцен
   * (`durationSec: 10` у всех девяти), и глушил звук клипов не там, где идёт речь.
   * Реплика не может звучать дольше своей сцены — микс её туда и не положит.
   */
  const voicedIntervals = mixScenes.map((s, index) => {
    // Конец сцены на таймлайне: старт клипа плюс его длина. sceneStartSec уже
    // сдвинут на вдох, поэтому границу считаем от слота, а не от него.
    const slot = finalTimeline[audiosToMix[index]!.clipIndex]
    const sceneEndSec = (slot?.startSec ?? s.sceneStartSec) + s.sceneDurationSec
    return {
      startSec: s.sceneStartSec,
      // Реплика обязана замолчать до конца своей сцены с запасом на хвост:
      // иначе она наезжает на следующий тейк, а он начинает говорить поверх.
      endSec: Math.min(s.sceneStartSec + s.voiceoverDurationSec, sceneEndSec - VOICE_TAIL_SEC),
    }
  })

  const totalDurationSec = effectiveClipDurations.reduce<number>((sum, d) => sum + (d ?? 0), 0)
    || scenes.reduce((sum, s) => sum + s.durationSec, 0)
  const mixPath = join(assetsDir, 'voiceover_mix.mp3')

  await appendStepLog(step.id, `Микширую ${mixScenes.length} сегментов в единый voiceover track (${totalDurationSec}s)`)
  const mixResult = await buildVoiceoverTrack({
    scenes: mixScenes,
    outputPath: mixPath,
    totalDurationSec,
  })

  // Save mix as VideoAsset
  const mixStorage = await uploadLocalAsset(
    mixPath,
    StorageKeys.videoVoiceoverMix(videoId),
    "audio/mpeg",
  )
  const mixAssetUrl = storageKeyToLegacyUrl(mixStorage.storageKey)
  const existingMixAsset = await prisma.videoAsset.findFirst({
    where: { videoId, type: "voiceover_mix" as never },
  })
  if (existingMixAsset) {
    await prisma.videoAsset.update({
      where: { id: existingMixAsset.id },
      data: {
        filePath: mixPath,
        fileUrl: mixAssetUrl,
        duration: Math.round(mixResult.durationSec),
        ...mixStorage,
      },
    })
  } else {
    await prisma.videoAsset.create({
      data: {
        videoId,
        type: "voiceover_mix" as never,
        filePath: mixPath,
        fileUrl: mixAssetUrl,
        order: 98,
        duration: Math.round(mixResult.durationSec),
        ...mixStorage,
      },
    })
  }

  const partialFailures = sceneResults.some(s => s.warning)
  const finalStatus: VoiceoverStepResult['status'] = partialFailures ? 'partial' : 'completed'

  const result: VoiceoverStepResult = {
    status: finalStatus,
    mixedPath: mixPath,
    mixedDurationSec: mixResult.durationSec,
    sceneResults,
    totalCostUsd: totalCost,
    provider: ttsModel.provider,
    modelId: ttsModel.id,
    voiceId: resolvedVoiceId,
    voicedIntervals,
    // Поле появляется ТОЛЬКО если extend_scene реально удлинила клипы — иначе
    // caller продолжает работать со своим массивом путей.
    ...(clipsExtended ? { clipPaths: effectiveClipPaths } : {}),
  }

  await updateStep(step.id, {
    status: "completed",
    finishedAt: new Date(),
    outputSnapshot: result as unknown as Record<string, unknown>,
    actualCost: accumulateStepCost(costBefore, totalCost),
  })
  await logStepCost(
    step.id,
    "voiceover_generation",
    mapStepKeyToService("voiceover_generation", ttsModel.id),
    totalCost,
    videoId,
    ttsModel.id,
    { attempt },
  )
  await appendStepLog(step.id, `Voiceover завершён: ${audiosToMix.length} сцен, mix=${mixResult.durationSec}s, стоимость $${totalCost.toFixed(3)}${partialFailures ? ' (partial — есть warnings)' : ''}`)

  return result
}

// ─── Шаг 3 (audio-first): единый трек озвучки ──────────────────
//
// Клипов на этом маршруте ещё нет — озвучка идёт ПЕРВОЙ и задаёт таймлайн,
// а не подстраивается под него. Существующая `runVoiceoverGeneration` выше
// остаётся маршрутом по умолчанию для всех нынешних роликов; эта функция —
// параллельная ветка, подключение которой к оркестратору делает следующий
// шаг плана.

export interface SingleTrackInput {
  videoId: number
  stepId: number
  scenes: Array<{ order: number, spokenLine: string | null }>
  voiceoverLines: Array<{ sceneOrder: number, text: string }>
  /** Голос ведущего. Синтез чужим голосом на его лицо недопустим — см. гейт ниже. */
  voiceId: string | null
  language: string
  outputPath: string
  /** Имя персонажа — для точного текста отказа, если голос не задан. */
  characterName?: string | null
}

export interface SingleTrackResult {
  trackPath: string
  durationSec: number
  costUsd: number
  scenes: AlignScene[]
  pauses: TrackPause[]
}

export interface SingleTrackDeps {
  synthesize?: (options: TtsSynthesisOptions) => Promise<Pick<TtsSynthesisResult, "audioPath" | "durationSec" | "costUsd">>
  /**
   * Режет трек по маркерам пауз и вставляет тишину. `durationSec` в ответе —
   * в норме ИЗМЕРЕННАЯ длительность готового файла (не сумма исходной
   * длительности и пауз): трек — эталон времени для дальнейшего монтажа,
   * вывести её арифметикой значило бы довериться складыванию там, где нужен
   * факт. Если ffprobe не смог измерить (транзиентный сбой на только что
   * созданном файле), сюда приходит лучшая доступная оценка — не 0, иначе
   * дальше по конвейеру молча отключились бы и подгон длины клипов, и
   * реальные тайминги субтитров — см. `durationEstimated`.
   * `skippedPauses` — паузы, для которых не нашлось точки вставки (тишина по
   * ним НЕ добавлена); пусто, если все паузы легли на место.
   * `sourceDurationMeasureFailed` — не удалось измерить ИСХОДНИК: тогда
   * `skippedPauses` содержит ВСЕ паузы не потому, что для них не нашлось
   * опорной сцены, а потому что резать было не от чего измерить — причина
   * другая, и лог обязан её различать.
   * `durationEstimated` — true, если `durationSec` выше это оценка, а не
   * измерение (при любой из трёх причин внутри `insertVoiceoverPauses`).
   * Значение кэшируется дальше по конвейеру как факт — лог обязан честно
   * предупредить об оценке, иначе отличить её от факта станет нечем.
   */
  insertPauses?: (path: string, pauses: TrackPause[], synthDurationSec: number) => Promise<{
    path: string
    durationSec: number
    skippedPauses: TrackPause[]
    sourceDurationMeasureFailed: boolean
    durationEstimated: boolean
  }>
  log?: (stepId: number, message: string) => Promise<void>
}

/**
 * Единый трек озвучки на весь ролик — одним вызовом TTS.
 *
 * Порядок: слить реплики в кадре и закадровые строки в один сценарный текст
 * (`mergeScriptLines`) → собрать текст для синтеза, очищенные сцены и список
 * пауз (`buildTrackRequest`) → отказ, если голосу неоткуда взяться → один
 * синтез → тишина по маркерам, если они есть.
 */
export async function runSingleTrackVoiceover(
  input: SingleTrackInput,
  deps: SingleTrackDeps = {},
): Promise<SingleTrackResult> {
  const synthesize = deps.synthesize ?? synthesizeSpeech
  const log = deps.log ?? appendStepLog

  const merged = mergeScriptLines({ scenes: input.scenes, voiceoverLines: input.voiceoverLines })
  const track = buildTrackRequest(merged)

  if (!input.voiceId) {
    const message = input.characterName
      ? presenterVoiceMissingMessage(input.characterName)
      : "Голос ролика не задан — синтезировать его чужим голосом нельзя"
    await log(input.stepId, message)
    throw new Error(message)
  }

  await log(input.stepId, `Синтезирую единый трек озвучки (${track.text.length} симв, ${track.scenes.length} сцен)`)
  const synthResult = await synthesize({
    text: track.text,
    outputPath: input.outputPath,
    voiceId: input.voiceId,
    language: input.language,
    videoId: input.videoId,
  })

  let trackPath = synthResult.audioPath
  let durationSec = synthResult.durationSec

  if (track.pauses.length > 0) {
    const insertPauses = deps.insertPauses
      ?? ((path: string, pauses: TrackPause[], synthDurationSec: number) =>
        insertVoiceoverPauses(path, pauses, track.scenes, synthDurationSec))
    const inserted = await insertPauses(trackPath, track.pauses, synthResult.durationSec)
    trackPath = inserted.path
    // В норме факт, а не арифметика: длительность результата — то, что
    // реально измерено на готовом файле. Наивная сумма "было + Σ пауз" молча
    // соврала бы, если склейка дала не ровно ту длину или какая-то пауза не
    // нашла точку вставки (см. skippedPauses ниже). Если ffprobe не смог
    // измерить вовсе, здесь — лучшая доступная оценка, а не 0
    // (`durationEstimated` ниже честно предупреждает об этом в лог).
    durationSec = inserted.durationSec

    if (inserted.sourceDurationMeasureFailed) {
      // Причина честная: не измерили исходный трек, поэтому разрез не
      // запускался вовсе — не путать с «не нашли точку вставки» ниже, та
      // причина про конкретную паузу без опорной сцены, а не про сбой ffprobe.
      await log(
        input.stepId,
        `Не удалось измерить длительность трека озвучки (ffprobe вернул 0) — паузы не вставлены, взята длина синтеза`,
      )
    } else {
      if (inserted.durationEstimated) {
        // Паузы РЕАЛЬНО вставлены (сплайсинг прошёл), но замер ГОТОВОГО
        // файла не удался — durationSec выше оценён суммой исходника и
        // вставленных пауз, а не измерен. Значение кэшируется дальше как
        // факт, поэтому молчать здесь нельзя.
        await log(
          input.stepId,
          `Не удалось измерить длительность трека после вставки пауз (ffprobe вернул 0) — длительность оценена по сумме исходника и пауз, а не измерена`,
        )
      }
      if (inserted.skippedPauses.length > 0) {
        await log(
          input.stepId,
          `Не нашли точку вставки для паузы после сцен(ы) ${inserted.skippedPauses.map(p => p.afterSceneOrder).join(", ")} — тишина не добавлена`,
        )
      }
    }
    await log(
      input.stepId,
      `Вставлено пауз: ${track.pauses.length - inserted.skippedPauses.length} из ${track.pauses.length}`,
    )
  }

  return {
    trackPath,
    durationSec,
    costUsd: synthResult.costUsd,
    scenes: track.scenes,
    pauses: track.pauses,
  }
}

// ─── Шаг 3 (audio-first): шаг озвучки целиком ──────────────────
//
// `runSingleTrackVoiceover` выше — только синтез. Здесь вокруг него собран сам
// ШАГ: гейты, переиспользование уже оплаченного трека, ассет в хранилище, деньги
// и снапшот. Отдельной функцией, потому что старый посценный шаг
// (`runVoiceoverGeneration`) остаётся нетронутым: у роликов без `editPipeline`
// не должно поменяться ни одного вызова.

/** Готовый трек ролика и всё, что о нём нужно знать дальнейшим шагам. */
export interface AudioFirstVoiceoverResult {
  status: "completed" | "skipped"
  trackPath: string | null
  /**
   * Длительность финального файла (после вставки пауз) — в норме ИЗМЕРЕННАЯ
   * ffprobe. Если замер транзиентно не удался (см. `insertVoiceoverPauses` /
   * `SingleTrackDeps.insertPauses`), здесь лучшая доступная оценка вместо
   * лжи про 0 — но не всегда факт, снапшот шага/лог это честно фиксируют.
   */
  durationSec: number
  /**
   * sha256 ФИНАЛЬНОГО файла — того, что получился после вставки пауз.
   *
   * Именно из него lip-sync режет куски, поэтому и ключи переиспользования сцен
   * обязаны считаться по нему. Отпечаток синтеза «до пауз» дал бы ключи по
   * одному файлу при звуке из другого.
   */
  trackFingerprint: string | null
  /** Ключ трека в хранилище: по нему транскрипция получает ссылку для провайдера. */
  storageKey: string | null
  /** Сцены с ОЧИЩЕННЫМ от маркеров пауз текстом — вход выравнивания. */
  scenes: AlignScene[]
  totalCostUsd: number
  modelId: string | null
  voiceId: string | null
  /** Почему трека нет. Заполняется только при status: "skipped". */
  reason?: string
}

/** Снапшот шага озвучки на маршруте audio-first. */
interface AudioFirstVoiceoverSnapshot {
  route: "audio_first"
  trackPath: string
  durationSec: number
  trackFingerprint: string
  storageKey: string | null
  scenes: AlignScene[]
  totalCostUsd: number
  modelId: string | null
  voiceId: string | null
}

function readAudioFirstSnapshot(snapshot: unknown): AudioFirstVoiceoverSnapshot | null {
  const value = snapshot as Partial<AudioFirstVoiceoverSnapshot> | null
  if (!value || value.route !== "audio_first") return null
  if (!value.trackPath || !value.trackFingerprint) return null
  return {
    route: "audio_first",
    trackPath: value.trackPath,
    durationSec: value.durationSec ?? 0,
    trackFingerprint: value.trackFingerprint,
    storageKey: value.storageKey ?? null,
    scenes: Array.isArray(value.scenes) ? value.scenes : [],
    totalCostUsd: value.totalCostUsd ?? 0,
    modelId: value.modelId ?? null,
    voiceId: value.voiceId ?? null,
  }
}

/**
 * Начинали ли ролик собирать ОТ ЗВУКА.
 *
 * Признак — снапшот шага озвучки в формате audio-first: единый трек уже
 * синтезирован, оплачен и залит, а куски под lip-sync и аватарные кадры
 * нарезаны по НЕМУ. Досбирать такой ролик прежним маршрутом нельзя: посценный
 * синтез оплатит речь второй раз и положит под уже снятые губы другой звук
 * (у TTS нет seed). Поэтому оркестратор по этому признаку не деградирует на
 * старый маршрут, а честно падает.
 *
 * Снапшот-отказ (`{ route: "audio_first", reason }`) сюда не считается: там
 * ничего не синтезировано и терять нечего.
 */
export async function hasAudioFirstTrack(videoId: number): Promise<boolean> {
  const step = await prisma.videoGenerationStep.findFirst({
    where: { videoId, stepKey: "voiceover_generation" as never },
    select: { outputSnapshot: true },
  })
  return readAudioFirstSnapshot(step?.outputSnapshot) !== null
}

async function fileIsReadable(path: string): Promise<boolean> {
  try {
    const { access: fsAccess } = await import("node:fs/promises")
    await fsAccess(path)
    return true
  } catch {
    return false
  }
}

/**
 * Возвращает уже оплаченный трек на диск.
 *
 * Локальный диск переживает не каждый рестарт (на Saturn его нет вовсе), а
 * повторный синтез — это не только второй платный вызов TTS: у модели нет seed,
 * новый трек звучит ИНАЧЕ, и все аватарные кадры, снятые под старый, становятся
 * губами под чужой звук. Поэтому сначала тянем файл из хранилища.
 */
async function restoreTrackFile(trackPath: string, storageKey: string | null): Promise<boolean> {
  if (await fileIsReadable(trackPath)) return true
  if (!storageKey) return false
  try {
    // Каталога ассетов после рестарта может не быть вовсе, а GCS-драйвер пишет
    // потоком в готовый путь и своей папки не создаёт.
    await ensureDir(dirname(trackPath))
    await getStorageDriver().downloadToFile(storageKey, trackPath)
  } catch {
    return false
  }
  return fileIsReadable(trackPath)
}

/** sha256 файла. Фолбэк на случай драйвера, который не считает его при заливке. */
async function sha256OfFile(path: string): Promise<string> {
  const { createHash } = await import("node:crypto")
  const { createReadStream } = await import("node:fs")
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on("data", chunk => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve())
  })
  return hash.digest("hex")
}

export async function runAudioFirstVoiceover(
  videoId: number,
  videoConfig: {
    /** Закадровый нарратор. Реплики ведущего в кадре от этого флага не зависят. */
    voiceoverEnabled: boolean
    voiceoverModelId: string | null
    voiceoverVoiceId: string | null
    voiceoverLanguage: string
    voiceoverPacing: 'slow' | 'moderate' | 'fast'
    /** Персонаж ведущего — нужен только ради внятного текста отказа без голоса. */
    lipSyncCharacterId: string | null
  },
  videoPlan?: StoryDrivenVideoPlan | null,
  deps: SingleTrackDeps = {},
): Promise<AudioFirstVoiceoverResult> {
  const step = await ensureStep(videoId, "voiceover_generation", STEP_ORDER.indexOf("voiceover_generation"))

  const isStoryDriven = !!videoPlan && videoPlan.mode !== 'legacy_simple'
  const planScenes = isStoryDriven ? videoPlan!.scenes : []
  const voiceoverPlan = videoPlan?.voiceoverPlan
  // Закадровые строки берём только если нарратор включён и планом, и настройкой
  // ролика. Реплики в кадре идут в трек всегда: это речь ведущего, а не озвучка.
  const narrationLines = videoConfig.voiceoverEnabled && voiceoverPlan?.enabled
    ? (voiceoverPlan.lines ?? [])
      .map(line => ({ sceneOrder: line.sceneOrder, text: line.text ?? "" }))
      .filter(line => line.text.trim().length > 0)
    : []
  const scenesForTrack = planScenes.map(scene => ({
    order: scene.order,
    spokenLine: scene.spokenLine ?? null,
  }))
  const hasScript = scenesForTrack.some(scene => (scene.spokenLine ?? "").trim().length > 0)
    || narrationLines.length > 0

  const empty: AudioFirstVoiceoverResult = {
    status: "skipped",
    trackPath: null,
    durationSec: 0,
    trackFingerprint: null,
    storageKey: null,
    scenes: [],
    totalCostUsd: 0,
    modelId: null,
    voiceId: null,
  }

  if (!isStoryDriven || !hasScript) {
    const reason = !isStoryDriven ? "legacy_mode_no_single_track" : "empty_script"
    const message = !isStoryDriven
      ? "Legacy mode (без StoryPlan) — единый трек собирать не из чего"
      : "В сценарии нет ни реплик в кадре, ни закадровых строк — озвучивать нечего"
    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
      outputSnapshot: { route: "audio_first", reason, userMessage: message },
    })
    await appendStepLog(step.id, `${message} (reason=${reason})`)
    return { ...empty, reason }
  }

  const cached = isStepCompleted(step) ? readAudioFirstSnapshot(step.outputSnapshot) : null
  if (cached) {
    if (await restoreTrackFile(cached.trackPath, cached.storageKey)) {
      await appendStepLog(
        step.id,
        `Единый трек уже синтезирован (${cached.durationSec} с, ${cached.scenes.length} сцен) — повторной оплаты нет`,
      )
      return { status: "completed", ...cached, totalCostUsd: 0 }
    }
    await appendStepLog(
      step.id,
      `Трека ${cached.trackPath} нет ни на диске, ни в хранилище — синтезирую заново`,
    )
  }

  // Номер попытки нужен ledger'у: повторный синтез — это реальное повторное
  // списание, и оно обязано быть отдельной строкой расхода (см. cost-ledger).
  const attempt = stepAttemptForLedger(step.attemptCount + 1)
  const costBefore = step.actualCost

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: attempt,
  })
  await updateVideoStatus(videoId, "generating_voiceover", { currentStep: "voiceover_generation" })

  const assetsDir = getAssetsDir(videoId)
  await ensureDir(assetsDir)
  const trackOutputPath = join(assetsDir, "voiceover_track.mp3")

  // Имя персонажа читаем ТОЛЬКО когда голоса нет: это путь отказа, и лишний
  // запрос в БД на каждом прогоне ради текста ошибки не нужен.
  const characterName = !videoConfig.voiceoverVoiceId && videoConfig.lipSyncCharacterId
    ? (await prisma.character.findUnique({
      where: { id: videoConfig.lipSyncCharacterId },
      select: { name: true },
    }))?.name ?? null
    : null

  try {
    const track = await runSingleTrackVoiceover({
      videoId,
      stepId: step.id,
      scenes: scenesForTrack,
      voiceoverLines: narrationLines,
      voiceId: videoConfig.voiceoverVoiceId,
      language: videoConfig.voiceoverLanguage,
      outputPath: trackOutputPath,
      characterName,
    }, {
      // Модель синтеза выбирает прогон, а не дефолт реестра: клон голоса
      // существует только в СВОЕЙ модели, и чужая просто не найдёт voice_id.
      synthesize: deps.synthesize ?? (options => synthesizeSpeech({
        ...options,
        modelId: videoConfig.voiceoverModelId,
        pacing: videoConfig.voiceoverPacing,
      })),
      insertPauses: deps.insertPauses,
      log: deps.log,
    })

    // Заливаем ФИНАЛЬНЫЙ файл (после пауз) — и отпечаток берём с него же.
    const storage = await uploadLocalAsset(
      track.trackPath,
      StorageKeys.videoVoiceoverMix(videoId),
      "audio/mpeg",
    )
    const trackFingerprint = storage.fileSha256 ?? await sha256OfFile(track.trackPath)
    const fileUrl = storageKeyToLegacyUrl(storage.storageKey)

    const existingAsset = await prisma.videoAsset.findFirst({
      where: { videoId, type: "voiceover_mix" as never },
    })
    if (existingAsset) {
      await prisma.videoAsset.update({
        where: { id: existingAsset.id },
        data: {
          filePath: track.trackPath,
          fileUrl,
          duration: Math.round(track.durationSec),
          ...storage,
        },
      })
    } else {
      await prisma.videoAsset.create({
        data: {
          videoId,
          type: "voiceover_mix" as never,
          filePath: track.trackPath,
          fileUrl,
          order: 98,
          duration: Math.round(track.durationSec),
          ...storage,
        },
      })
    }

    const snapshot: AudioFirstVoiceoverSnapshot = {
      route: "audio_first",
      trackPath: track.trackPath,
      durationSec: track.durationSec,
      trackFingerprint,
      storageKey: storage.storageKey,
      scenes: track.scenes,
      totalCostUsd: track.costUsd,
      modelId: videoConfig.voiceoverModelId,
      voiceId: videoConfig.voiceoverVoiceId,
    }
    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      // Ошибка прошлой попытки (например, синтез упал на таймауте) не должна
      // оставаться на успешном шаге: перезапуск бывает и без сброса полей.
      errorMessage: null,
      outputSnapshot: snapshot as unknown as Record<string, unknown>,
      actualCost: accumulateStepCost(costBefore, track.costUsd),
    })
    await logStepCost(
      step.id,
      "voiceover_generation",
      mapStepKeyToService("voiceover_generation", videoConfig.voiceoverModelId),
      track.costUsd,
      videoId,
      videoConfig.voiceoverModelId,
      { attempt },
    )
    await appendStepLog(
      step.id,
      `Единый трек готов: ${track.durationSec} с, ${track.scenes.length} сцен, пауз ${track.pauses.length}, `
      + `стоимость $${track.costUsd.toFixed(3)}`,
    )

    return { status: "completed", ...snapshot, totalCostUsd: track.costUsd }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка"
    await updateStep(step.id, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: message.slice(0, 500),
    })
    await appendStepLog(step.id, `Единый трек не синтезирован: ${message}`)
    throw error
  }
}

// ─── Шаг 3b (audio-first): транскрипция готового трека ─────────

export interface VideoTranscriptionResult {
  /**
   * `degraded` — границы есть, но сошлись меньше чем на половине слов: монтаж
   * возможен, точность хуже. Статуса «пропущено» тут нет намеренно: шаг либо
   * отдаёт границы, либо падает (см. шапку `runVideoTranscription`).
   */
  status: "completed" | "degraded"
  /** Сцены с фактическими границами. Пустыми не бывают — иначе шаг бросает. */
  scenes: AlignedScene[]
  costUsd: number
  warning: string | null
}

/**
 * Ассет транскрипта.
 *
 * Сырой ответ модели уже лежит в хранилище (его кладёт туда `runMediaTask` по
 * ключу `StorageKeys.videoTranscript`), поэтому здесь только запись в БД: без
 * неё файл не попадёт ни в каскад удаления ролика, ни в orphan-scan. Сами
 * ВЫРОВНЕННЫЕ сцены живут в снапшоте шага — их читают дальнейшие шаги.
 *
 * Дефолт сразу для ДВУХ колбэков `runTranscriptionStep`: `saveTranscript`
 * (успех/деградация — с уже выровненными сценами) и `persistRawAsset`
 * (разбор ответа провалился — payload тот же, только без сцен). Сигнатура
 * ниже принимает исключительно `{ videoId, localPath }`, поэтому годится для
 * обоих — файл регистрируется независимо от того, удалось ли его разобрать.
 */
async function persistTranscriptAsset(payload: {
  videoId: number
  localPath: string
}): Promise<void> {
  const storageKey = StorageKeys.videoTranscript(payload.videoId)
  const data = {
    filePath: payload.localPath,
    fileUrl: storageKeyToLegacyUrl(storageKey),
    storageKey,
    storageProvider: getStorageDriver().providerName,
    contentType: "application/json",
  }
  const existing = await prisma.videoAsset.findFirst({
    where: { videoId: payload.videoId, type: "transcript" as never },
  })
  if (existing) {
    await prisma.videoAsset.update({ where: { id: existing.id }, data })
  } else {
    await prisma.videoAsset.create({
      data: { videoId: payload.videoId, type: "transcript" as never, order: 0, ...data },
    })
  }
}

/**
 * Шаг транскрипции: границы слов НАШЕЙ ЖЕ озвучки.
 *
 * Шаг ОБЯЗАТЕЛЕН для маршрута «монтаж от звука» и при отказе бросает. Это
 * сознательная замена деградации, обещанной spec §10: собрать такой ролик «по
 * плановым длительностям» нельзя — без границ lip-sync пропускает каждую сцену
 * ведущего (`track_segment_missing`), своих клипов у этих сцен нет, и на выходе
 * получается склейка перебивок под непрерывную речь со статусом «готово».
 *
 * Ролик, у которого транскрипция недоступна В ПРИНЦИПЕ (модель не настроена),
 * до этого шага не доходит: маршрут выбирается ДО оплаты трека, см.
 * `isTranscriptionRouteAvailable`.
 */
export async function runVideoTranscription(
  input: {
    videoId: number
    /** Готовый трек: локальный файл, отпечаток и ключ в хранилище. */
    track: { path: string, fingerprint: string, storageKey: string | null }
    /** Сцены с очищенным текстом — их отдаёт шаг озвучки. */
    scenes: AlignScene[]
    language: string
  },
  deps: Partial<TranscriptionStepDeps> = {},
): Promise<VideoTranscriptionResult> {
  const { videoId } = input
  const step = await ensureStep(videoId, "transcription", STEP_ORDER.indexOf("transcription"))

  /** Отказ шага: снимок причины, запись в лог и исключение наверх. */
  const failStep = async (reason: string, message: string): Promise<never> => {
    await updateStep(step.id, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: message.slice(0, 500),
      outputSnapshot: { trackFingerprint: input.track.fingerprint, reason, userMessage: message, scenes: [] },
    })
    await appendStepLog(step.id, message)
    throw new Error(message)
  }

  if (input.scenes.length === 0) {
    return failStep(
      "empty_script",
      "Транскрипция ролика: трек синтезирован, а сцен с текстом нет — выравнивать нечего",
    )
  }

  // Кэш привязан к ОТПЕЧАТКУ ТРЕКА: перезаписанный трек звучит иначе при том же
  // тексте, и старые границы слов относились бы к другому звуку.
  if (isStepCompleted(step) && step.outputSnapshot) {
    const cached = step.outputSnapshot as { trackFingerprint?: string, scenes?: AlignedScene[], warning?: string | null }
    if (cached.trackFingerprint === input.track.fingerprint && Array.isArray(cached.scenes) && cached.scenes.length > 0) {
      await appendStepLog(step.id, `Транскрипт этого трека уже готов (${cached.scenes.length} сцен) — повторной оплаты нет`)
      return { status: "completed", scenes: cached.scenes, costUsd: 0, warning: cached.warning ?? null }
    }
  }

  // Трек обязан быть залит в объектное хранилище — это отдельная гарантия от
  // способа передачи файла провайдеру: без неё файл не попадёт ни в каскад
  // удаления ролика, ни в orphan-scan, а recovery не найдёт его после
  // рестарта. Самому вызову провайдера ссылка из хранилища больше не нужна —
  // `requestTranscription` заливает БАЙТЫ локального файла (`input.track.path`)
  // напрямую (inputUploads), тем же способом, каким уже работают lip-sync и
  // аватарный маршрут. Раньше здесь брали `getSignedDownloadUrl`, а у
  // ЛОКАЛЬНОГО драйвера хранилища это ОТНОСИТЕЛЬНЫЙ путь (`/api/files/...`),
  // который Replicate не может скачать — 422 при создании задачи (canary
  // 26.08.2026, третий прогон, `transcription-upload-report.md`).
  if (!input.track.storageKey) {
    return failStep(
      "track_not_in_storage",
      "Транскрипция ролика: трек не залит в хранилище — без постоянной копии транскрипция не подтверждена",
    )
  }

  const attempt = stepAttemptForLedger(step.attemptCount + 1)
  const costBefore = step.actualCost
  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: attempt,
  })
  await updateVideoStatus(videoId, "generating_voiceover", { currentStep: "transcription" })

  const assetsDir = getAssetsDir(videoId)
  await ensureDir(assetsDir)

  // Запись расхода — идемпотентна (флаг ниже), но САМА по себе не выполняется
  // внутри раннера: `runner.ts:83-99` оборачивает вызов `runTask` в try/catch,
  // который любое исключение (в том числе из записи в БД) превращает в
  // `{ status: "skipped", costUsd: 0 }`. Если бы recordCost писала в БД из
  // обёртки runTask, сбой самой записи (обрыв соединения, конфликт) молча
  // притворился бы отказом провайдера, а уже известная стоимость потерялась
  // бы. Поэтому обёртка runTask ниже только ЗАПОМИНАЕТ стоимость, а сама
  // запись выполняется СНАРУЖИ `runTranscriptionStep` — на обоих путях,
  // успешном и бросковом.
  let costRecorded = false
  const recordCost = async (costUsd: number): Promise<void> => {
    if (costUsd <= 0 || costRecorded) return
    costRecorded = true
    await updateStep(step.id, { actualCost: accumulateStepCost(costBefore, costUsd) })
    await logStepCost(
      step.id,
      "transcription",
      mapStepKeyToService("transcription", null),
      costUsd,
      videoId,
      null,
      { attempt },
    )
  }

  const baseRunTask = deps.runTask ?? requestTranscription
  let matchedRatio: number | null = null
  /** Стоимость, о которой отчитался провайдер, — до любой записи в БД. */
  let observedCost = 0
  let result: TranscriptionStepResult
  try {
    result = await runTranscriptionStep({
      videoId,
      stepId: step.id,
      audioPath: input.track.path,
      scenes: input.scenes,
      language: input.language,
      outputPath: join(assetsDir, "transcript.json"),
    }, {
      // Только запоминаем стоимость, без записи в БД: этот колбэк выполняется
      // внутри try/catch раннера (см. комментарий выше), и запись отсюда
      // рисковала бы быть проглоченной вместе с любым сбоем самой записи.
      runTask: async (taskInput) => {
        const task = await baseRunTask(taskInput)
        observedCost = task.costUsd
        return task
      },
      saveTranscript: deps.saveTranscript ?? (async (payload) => {
        matchedRatio = payload.matchedRatio
        await persistTranscriptAsset({ videoId: payload.videoId, localPath: payload.localPath })
      }),
      persistRawAsset: deps.persistRawAsset ?? persistTranscriptAsset,
      log: deps.log ?? appendStepLog,
    })
  } catch (error) {
    // Раннер бросил не «мягким» skipped-результатом, а настоящим исключением
    // (например, сохранение транскрипта упало на БД). Пишем известную
    // стоимость СНАРУЖИ swallow-зоны раннера — сбой самой записи здесь уже не
    // спрячется под чужой причиной, а уйдёт наверх честно. Только потом шаг
    // уходит в failed, а не зависает в running.
    await recordCost(observedCost)
    const message = error instanceof Error ? error.message : String(error)
    return failStep(
      "transcription_step_threw",
      `Транскрипция ролика: шаг упал (${message})`,
    )
  }

  // Раннер завершился без исключения — на этом пути расход ещё не записан
  // (запись из catch выше не выполнялась), пишем его здесь той же функцией.
  await recordCost(observedCost)

  // Границ нет — шаг падает. Трек к этому моменту уже синтезирован и оплачен,
  // а без выравнивания lip-sync не возьмёт звук НИ ОДНОЙ сцены ведущего: ролик
  // собрался бы из одних перебивок под непрерывную речь и получил статус
  // «готов». Честный отказ дешевле такого брака — оператор увидит ошибку и
  // решит сам: чинить транскрипцию или выключить маршрут.
  if (result.scenes.length === 0) {
    return failStep(
      "alignment_missing",
      `Транскрипция не дала границ слов (${result.warning ?? "причина не указана"}) — `
      + "на маршруте «монтаж от звука» без них не собрать ни одной сцены ведущего",
    )
  }

  await updateStep(step.id, {
    status: "completed",
    finishedAt: new Date(),
    // Чистим явно: шаг мог падать на прошлой попытке, и текст той ошибки на
    // успешном шаге читается в UI как сбой. Полагаться на то, что кто-то
    // сбросил поле раньше, нельзя — перезапуск бывает и без сброса.
    errorMessage: null,
    outputSnapshot: {
      trackFingerprint: input.track.fingerprint,
      status: result.status,
      scenes: result.scenes,
      matchedRatio,
      warning: result.warning,
    } as unknown as Record<string, unknown>,
  })
  // Деградация выравнивания (границы приблизительные) — это предупреждение в
  // лог шага, а НЕ errorMessage: успешный шаг с текстом ошибки читается в UI
  // как сбой, и оператор идёт чинить работающий ролик.
  if (result.warning) await appendStepLog(step.id, `Предупреждение: ${result.warning}`)

  return {
    // "skipped" раннера сюда не доходит: пустой результат отсечён отказом выше,
    // и пересобираем ответ явно, а не приведением типа.
    status: result.status === "degraded" ? "degraded" : "completed",
    scenes: result.scenes,
    costUsd: result.costUsd,
    warning: result.warning,
  }
}

// ─── Шаг 3c (audio-first): план монтажа ─────────────────────────

export interface VideoEditPlanResult {
  status: "completed" | "repaired"
  shots: PlannedShotWithCost[]
  /** Ledger-цена ЭТОГО шага (вызовы Anthropic) — то, что ушло в AiAuditLog. */
  costUsd: number
  /** Прогнозная смета будущих фонов по плану — НЕ ledger, только для outputSnapshot/оценки ролика §14. */
  plannedMediaCostUsd: number
  warnings: string[]
}

/**
 * `EDIT_PLAN_MODEL_CALL_ESTIMATE_USD` (`video-cost-actual.ts`) здесь —
 * ТОЛЬКО fallback (Critical 1 ре-ревью задачи, фикс-раунд 2), когда для
 * конкретного вызова нельзя посчитать реальную цену по токенам:
 *
 * 1. `ANTHROPIC_MOCK_MODE` — `tryMockAnthropicAgent` отдаёт статическую
 *    фикстуру и не зовёт `onUsage` вовсе, usage физически нет (`null`).
 * 2. Модель вызвана по-настоящему (usage есть), но её нет в тарифной таблице
 *    `ai-pricing.ts` — `EditProfile.llmModelId` разрешает произвольную
 *    строку, и будущая/кастомная версия модели туда законно не попадёт.
 *
 * В фикс-раунде 1 эта константа ошибочно была ЕДИНСТВЕННЫМ механизмом (см.
 * git-историю) — ре-ревью потребовало реального токенного расчёта через
 * `calculateAnthropicCost`, потому что промпт агента растёт вместе с сеткой
 * кадров (см. `estimateMaxTokens` в `edit-planner-agent.ts`), а сетка — с
 * длиной ролика: плоская оценка систематически ЗАНИЖАЕТ цену на длинных
 * роликах, тем же классом ошибки, что и заниженная ставка Kling в Task 4.
 * Теперь это fallback на случай, когда токенных данных нет, а НЕ основной путь.
 *
 * Константа вынесена в `video-cost-actual.ts` (правка тарифа 24.08.2026):
 * `estimateVideoCost` (`video-cost.ts`) обязана оценивать шаг `edit_plan` тем
 * же числом, что здесь списывается как fallback, а не отдельным литералом.
 */

/**
 * Считает ledger-цену ОДНОГО вызова монтажного агента.
 *
 * Основной путь — реальный токенный расчёт (`calculateAnthropicCost`),
 * `measured: true`. Резервный — плоская оценка
 * `EDIT_PLAN_MODEL_CALL_ESTIMATE_USD` (`measured: false`), но НИКОГДА молча:
 * если usage есть, а модели нет в тарифной таблице, в лог шага уходит явное
 * сообщение с известными токенами (чтобы тарифную таблицу можно было
 * дополнить по факту) — цена вызова в этом случае была бы иначе тихим нулём,
 * а вызов реально оплачен. Если usage нет вовсе (мок), fallback молчит:
 * это ожидаемое поведение теста, не сигнал дыры в учёте.
 */
async function priceEditPlanModelCall(
  usage: EditPlanModelUsage | null,
  stepId: number,
): Promise<{ costUsd: number, measured: boolean }> {
  if (!usage) return { costUsd: EDIT_PLAN_MODEL_CALL_ESTIMATE_USD, measured: false }

  const computed = calculateAnthropicCost(usage.model, usage)
  if (computed !== null) return { costUsd: computed, measured: true }

  await appendStepLog(
    stepId,
    `План монтажа: модель "${usage.model}" не найдена в тарифной таблице (ai-pricing.ts) — реальная цена вызова `
    + `НЕ измерена. Известные токены: input=${usage.inputTokens}, output=${usage.outputTokens}, `
    + `cacheRead=${usage.cacheReadTokens ?? 0}, cacheCreate=${usage.cacheCreateTokens ?? 0}. `
    + `Списана резервная оценка $${EDIT_PLAN_MODEL_CALL_ESTIMATE_USD} вместо измеренной цены — `
    + `дополните тарифную таблицу этой моделью.`,
  )
  return { costUsd: EDIT_PLAN_MODEL_CALL_ESTIMATE_USD, measured: false }
}

/**
 * Сумма ledger-цены по ВСЕМ реальным попыткам (Critical 1, п.3 ре-ревью,
 * фикс-раунд 2): несходящийся ремонт платит за обе. `estimated: true`, если
 * ХОТЬ ОДНА попытка не измерена по токенам — мелочь ре-ревью 3: `AiAuditLog`
 * различает измеренную цену от оценённой через `metadata.estimated`
 * (`logStepCost`), а не только текстом в логе шага.
 */
async function priceEditPlanModelCalls(
  usages: readonly (EditPlanModelUsage | null)[],
  stepId: number,
): Promise<{ costUsd: number, estimated: boolean }> {
  let total = 0
  let estimated = false
  for (const usage of usages) {
    const priced = await priceEditPlanModelCall(usage, stepId)
    total += priced.costUsd
    if (!priced.measured) estimated = true
  }
  return { costUsd: total, estimated }
}

/**
 * Модель для колонки `model` в `AiAuditLog` (мелочь ре-ревью 3): раньше
 * всегда бралась `input.profile.llmModelId`, а при дефолтном профиле
 * (`llmModelId === null`) `logStepCost`/`logServiceCost` подставляли
 * `model: modelId ?? resolvedService`, то есть буквально СЕРВИС
 * ("anthropic") в колонку модели — хотя фактическая модель уже известна из
 * `usage.model` (`callAnthropicAgent` резолвит дефолт сама, см.
 * `call-anthropic.ts`). Берём первый РЕАЛЬНЫЙ usage; если usage нет вовсе
 * (мок/фолбэк) — старое поведение как безопасный запасной путь.
 */
function resolveEditPlanModelId(
  profile: ResolvedEditProfile,
  usages: readonly (EditPlanModelUsage | null)[],
): string | null {
  return usages.find((usage): usage is EditPlanModelUsage => usage !== null)?.model ?? profile.llmModelId
}

/**
 * Только поля профиля, которые реально влияют на ПЛАН (Important 1/2
 * ре-ревью задачи): `pipPosition`/`pipSize`/`generativeVideoResolution`/
 * `stepwiseApproval` не читает ни `grid.ts`, ни `edit-planner-agent.ts`, ни
 * `pickBackgroundSource` — их правка не должна стоить повторной оплаты
 * агента. `pipEnabled` остаётся: раннер клэмпит им `VideoShot.pipEnabled`,
 * то есть он ВЛИЯЕТ на итоговые кадры.
 *
 * ВНИМАНИЕ тому, кто добавляет поле в `ResolvedEditProfile` (сомнение №2
 * ре-ревью, принято как есть координатором): список ручной, не выводится из
 * типа. Новое поле, которое реально влияет на план (читается `grid.ts`,
 * `edit-planner-agent.ts` или `pickBackgroundSource`), но не добавлено сюда,
 * даст молча УСТАРЕВШИЙ план из кэша — `editPlanCacheKey` не заметит его
 * смены. Автоматизировать вывод "влияет ли поле на план" из типа
 * невозможно — так решили сознательно: неверная автоматика хуже честного
 * списка, который хотя бы виден при код-ревью.
 */
function planningRelevantProfile(profile: ResolvedEditProfile) {
  return {
    editPrompt: profile.editPrompt,
    brollRatio: profile.brollRatio,
    shotChangeSec: profile.shotChangeSec,
    pipEnabled: profile.pipEnabled,
    generativeVideoEnabled: profile.generativeVideoEnabled,
    generativeVideoBudgetUsd: profile.generativeVideoBudgetUsd,
    llmModelId: profile.llmModelId,
    // Ре-ревью 3, Task 5, пункт 1: раньше imageGenerationAllowed вычислялся
    // из реестра моделей (не из профиля) и в ключ кэша не попадал вовсе.
    // Теперь это профильный флаг — влияет на pickBackgroundSource ровно как
    // остальные поля этого списка, значит обязан промахивать кэш при смене.
    imageGenerationEnabled: profile.imageGenerationEnabled,
  }
}

export interface VideoEditPlanInput {
  videoId: number
  /** Отпечаток трека, для которого строится план — часть ключа кэша. */
  trackFingerprint: string
  trackDurationSec: number
  fps: number
  alignedScenes: readonly AlignedScene[]
  /** Сцены, где ведущий говорит В КАДРЕ — вход дефолта раннера. */
  presenterSceneOrders: readonly number[]
  /** Уже разрешённый профиль (resolveEditProfile) — раннер профиль не резолвит сам. */
  profile: ResolvedEditProfile
  lipSyncMaxDurationSec: number
  format: "portrait" | "landscape"
  renderQuality: string
  backgrounds: readonly EditPlanBackgroundOption[]
  appScreens: readonly EditPlanAppScreenOption[]
}

/**
 * Ключ кэша шага (требование 6 ревью задачи, сужен и расширен в фикс-раунде 1
 * по Important 1/2): отпечаток трека + число сцен + потолок lip-sync + состав
 * доступных фонов/скринов + ТОЛЬКО планing-релевантные поля профиля.
 *
 * Important 1: раньше ключ не включал `lipSyncMaxDurationSec` и состав
 * `backgrounds`/`appScreens` — смена lip-sync модели (другой потолок) или
 * заливка нового фона в библиотеку не промахивали кэш, и план оставался
 * посчитан под старые условия.
 * Important 2: раньше профиль сериализовался ЦЕЛИКОМ — правка `pipPosition`,
 * `pipSize`, `generativeVideoResolution` или `stepwiseApproval` (полей, не
 * влияющих ни на сетку, ни на промпт агента, ни на `pickBackgroundSource`)
 * промахивала кэш и заново платила за агента без всякой причины.
 *
 * Идентификаторы фонов/скринов отсортированы: порядок enumeration из БД не
 * гарантирован и не должен решать, совпал кэш или нет на ОДНОМ и том же
 * множестве id.
 */
function editPlanCacheKey(input: {
  trackFingerprint: string
  profile: ResolvedEditProfile
  sceneCount: number
  lipSyncMaxDurationSec: number
  backgroundIds: readonly string[]
  appScreenIds: readonly string[]
}): string {
  return JSON.stringify({
    trackFingerprint: input.trackFingerprint,
    profile: planningRelevantProfile(input.profile),
    sceneCount: input.sceneCount,
    lipSyncMaxDurationSec: input.lipSyncMaxDurationSec,
    backgroundIds: [...input.backgroundIds].sort(),
    appScreenIds: [...input.appScreenIds].sort(),
  })
}

interface EditPlanSnapshot {
  cacheKey: string
  status: "completed" | "repaired"
  shots: PlannedShotWithCost[]
  plannedMediaCostUsd: number
  warnings: string[]
}

function readEditPlanSnapshot(snapshot: unknown): EditPlanSnapshot | null {
  const value = snapshot as Partial<EditPlanSnapshot> | null
  if (!value || typeof value.cacheKey !== "string" || !Array.isArray(value.shots)) return null
  return {
    cacheKey: value.cacheKey,
    status: value.status === "repaired" ? "repaired" : "completed",
    shots: value.shots,
    plannedMediaCostUsd: typeof value.plannedMediaCostUsd === "number" ? value.plannedMediaCostUsd : 0,
    warnings: Array.isArray(value.warnings) ? value.warnings : [],
  }
}

/**
 * Шаг плана монтажа: сетка кадров кодом, смысл моделью, ремонт до неподвижной
 * точки, каждый кадр — через `pickBackgroundSource` (§7). Идемпотентность —
 * по образцу `runVideoTranscription` выше: `ensureStep` → кэш по
 * `isStepCompleted(step) && step.outputSnapshot` с ключом
 * {@link editPlanCacheKey} → `updateStep` → `logStepCost`. Продовая реализация
 * `saveShots` делает `deleteMany`+`createMany` ОДИН раз за прогон — ровно
 * тогда, когда кэш уже сказал "это новый план", а не на каждом повторе шага.
 */
export async function runVideoEditPlan(
  input: VideoEditPlanInput,
  deps: Partial<EditPlanStepDeps> = {},
): Promise<VideoEditPlanResult> {
  const { videoId } = input
  const step = await ensureStep(videoId, "edit_plan", STEP_ORDER.indexOf("edit_plan"))

  const backgroundIds = input.backgrounds.map(b => b.id)
  const appScreenIds = input.appScreens.map(s => s.id)
  const cacheKey = editPlanCacheKey({
    trackFingerprint: input.trackFingerprint,
    profile: input.profile,
    sceneCount: input.alignedScenes.length,
    lipSyncMaxDurationSec: input.lipSyncMaxDurationSec,
    backgroundIds,
    appScreenIds,
  })

  // Требование 7 ревью задачи: снимок разрешённого профиля пишется в лог шага.
  // resolveEditProfile молча заменяет мусорные настройки дефолтами, и сама она
  // остаётся чистой функцией — без этой строки подмена не видна нигде.
  await appendStepLog(step.id, `Разрешённый профиль монтажа: ${JSON.stringify(input.profile)}`)

  if (isStepCompleted(step) && step.outputSnapshot) {
    const cached = readEditPlanSnapshot(step.outputSnapshot)
    if (cached && cached.cacheKey === cacheKey) {
      await appendStepLog(step.id, `План монтажа для этого трека уже готов (${cached.shots.length} кадров) — повторной оплаты нет`)
      return { status: cached.status, shots: cached.shots, costUsd: 0, plannedMediaCostUsd: cached.plannedMediaCostUsd, warnings: cached.warnings }
    }
  }

  const attempt = stepAttemptForLedger(step.attemptCount + 1)
  const costBefore = step.actualCost
  await updateStep(step.id, { status: "running", startedAt: new Date(), attemptCount: attempt })
  await updateVideoStatus(videoId, "generating_images", { currentStep: "edit_plan" })

  // Ставки — из спек моделей, не литералы (требование 5 ревью задачи).
  const videoBilling = replicateVideoBilling()
  const imageSpec = findMediaSpec("replicate:flux-dev")
  const imageModelAvailable = imageSpec !== null
  // Ре-ревью 3, Task 5, пункт 1: `imageSpec !== null` — реестр моделей
  // СТАТИЧЕСКИЙ (`Object.freeze([...])`), flux-dev в нём стоит первым, это
  // выражение ВСЕГДА true — хардкод, переехавший из runner.ts сюда же, а не
  // реальный сигнал. §10 «фонов нет, генерация запрещена → кадр ведущему»
  // была недостижимой веткой в проде, а у оператора не было рычага против
  // расхода на картинки. Правильный сигнал — профильный флаг
  // `imageGenerationEnabled` (единственный реальный выключатель); проверка
  // реестра остаётся ВТОРЫМ, независимым условием на случай, если модель
  // когда-нибудь реально пропадёт из реестра — тогда imageUsd=0 не должен
  // молча сделать план «бесплатным» (M-4), а обязан запретить генерацию тем
  // же флагом.
  const imageGenerationAllowed = input.profile.imageGenerationEnabled && imageModelAvailable
  const imageUsd = imageSpec
    ? estimateMediaCost(imageSpec, { images: 1, megapixels: imageMegapixels(input.format, input.renderQuality) })
    : 0
  if (!input.profile.imageGenerationEnabled) {
    await appendStepLog(
      step.id,
      `Генерация картинки выключена профилем монтажа (imageGenerationEnabled=false) — `
      + `кадры без библиотечного/платного фона отдаются ведущему (§10)`,
    )
  } else if (!imageModelAvailable) {
    await appendStepLog(
      step.id,
      `Модель flux-dev не найдена в реестре — генерация картинки недоступна в этом прогоне, `
      + `кадры без библиотечного/платного фона отдаются ведущему (§10)`,
    )
  }

  // Ре-ревью 3, Critical 1, п.2: копится ВНЕ runEditPlanStep — падение ПОСЛЕ
  // последнего успешного вызова askModel (непарсимый ответ следующей попытки,
  // либо saveShots) не должно унести с собой usage УЖЕ реально оплаченных
  // вызовов. `result.modelUsages`/`EditPlanUnresolvedError.modelUsages`
  // остаются как были (полезны для изолированных тестов раннера) — эта
  // переменная СВОЯ и заведомо надёжнее: пишется по мере поступления usage,
  // а не читается из возврата/исключения runEditPlanStep постфактум.
  const collectedUsages: Array<EditPlanModelUsage | null> = []

  const defaultDeps: EditPlanStepDeps = {
    askModel: async (grid, context, reportUsage) => {
      const response = await planEditShots({
        editPrompt: context.editPrompt,
        grid: grid.map(cell => ({
          order: cell.order,
          startSec: cell.startSec,
          endSec: cell.endSec,
          sceneOrder: cell.sceneOrder,
          text: cell.text,
        })),
        backgrounds: context.backgrounds,
        appScreens: context.appScreens,
        presenterSceneOrders: context.presenterSceneOrders,
        brollRatio: context.brollRatio,
        shotChangeSec: context.shotChangeSec,
        pipAllowed: context.pipAllowed,
        generativeVideoAllowed: context.generativeVideoAllowed,
        model: input.profile.llmModelId,
        previousErrors: context.previousErrors,
        // Синхронно, ДО JSON-парсинга/validate() внутри callAnthropicAgent —
        // именно это и переживает исключение из-за обрезанного ответа.
        onUsage: (usage) => { reportUsage(usage) },
      })
      return { shots: response.shots }
    },
    saveShots: async (shots) => {
      // Один прогон = одна транзакция: удалить прошлый план целиком (если он
      // был) и вставить свежий. Идемпотентность гарантирует кэш ВЫШЕ — эта
      // функция вызывается только когда кэш уже сказал "план новый".
      await prisma.$transaction([
        prisma.videoShot.deleteMany({ where: { videoId } }),
        prisma.videoShot.createMany({
          data: shots.map(shot => ({
            videoId,
            order: shot.order,
            startSec: shot.startSec,
            endSec: shot.endSec,
            sceneOrder: shot.sceneOrder,
            foreground: shot.foreground,
            background: shot.background,
            backgroundClipId: shot.backgroundClipId,
            appReferenceId: shot.appReferenceId,
            idea: shot.idea,
            pipEnabled: shot.pipEnabled,
            costUsd: shot.costUsd,
            degradeReason: shot.degradeReason,
            status: "planned",
          })),
        }),
      ])
    },
    log: async (message) => { await appendStepLog(step.id, message) },
  }

  let result: EditPlanStepResult
  try {
    result = await runEditPlanStep({
      videoId,
      trackDurationSec: input.trackDurationSec,
      fps: input.fps,
      alignedScenes: input.alignedScenes,
      presenterSceneOrders: input.presenterSceneOrders,
      profile: input.profile,
      lipSyncMaxDurationSec: input.lipSyncMaxDurationSec,
      minGenerativeVideoSec: REPLICATE_KLING_16_DURATIONS[0]!,
      maxGenerativeVideoSec: REPLICATE_KLING_16_DURATIONS[1]!,
      generativeVideoUsdPerSec: videoBilling.usdPerSecond,
      imageUsd,
      imageGenerationAllowed,
      backgrounds: input.backgrounds,
      appScreens: input.appScreens,
    }, {
      askModel: deps.askModel ?? defaultDeps.askModel,
      saveShots: deps.saveShots ?? defaultDeps.saveShots,
      log: deps.log ?? defaultDeps.log,
      onModelUsage: (usage) => { collectedUsages.push(usage) },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Critical 1 ревью задачи, п.1 и п.3 (фикс-раунд 2 и 3): при несходимости
    // ремонта, а ТАКЖЕ при непарсимом ответе модели и падении saveShots
    // (ре-ревью 3, п.2), уже оплаченные попытки не должны пропасть из
    // ledger только потому, что шаг в итоге падает. `collectedUsages`
    // копится через `onModelUsage`/`reportUsage` НЕЗАВИСИМО от того, как
    // именно и на каком шаге брошено исключение — не только когда это
    // `EditPlanUnresolvedError`.
    const { costUsd: agentCostUsd, estimated } = await priceEditPlanModelCalls(collectedUsages, step.id)
    await updateStep(step.id, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: message.slice(0, 500),
      actualCost: accumulateStepCost(costBefore, agentCostUsd),
    })
    if (agentCostUsd > 0) {
      await logStepCost(
        step.id, "edit_plan", mapStepKeyToService("edit_plan", null), agentCostUsd, videoId,
        resolveEditPlanModelId(input.profile, collectedUsages), { attempt, estimated },
      )
    }
    await appendStepLog(step.id, `План монтажа не построен: ${message}`)
    throw error
  }

  // Ledger получает РЕАЛЬНУЮ токенную цену вызова(ов) агента (Critical 1,
  // фикс-раунд 2), а НЕ `result.plannedMediaCostUsd` (Critical 1, фикс-раунд
  // 1) и НЕ плоскую константу (см. докстринг `EDIT_PLAN_MODEL_CALL_ESTIMATE_USD`
  // — она теперь только fallback). Прогнозная смета фонов уходит только в
  // outputSnapshot, для будущей оценки ролика (§14), и в ledger не попадает
  // никогда: она посчитается ЗАНОВО и по-настоящему, когда шаг генерации
  // фонов реально их сгенерирует.
  //
  // `collectedUsages`, а не `result.modelUsages` (ре-ревью 3): те совпадают
  // в счастливом пути, но только `collectedUsages` остаётся источником
  // истины и на путях, где `result` вообще не был вычислен (см. catch выше).
  const { costUsd: agentCostUsd, estimated } = await priceEditPlanModelCalls(collectedUsages, step.id)

  await updateStep(step.id, {
    status: "completed",
    finishedAt: new Date(),
    errorMessage: null,
    outputSnapshot: {
      cacheKey,
      status: result.status,
      shots: result.shots,
      plannedMediaCostUsd: result.plannedMediaCostUsd,
      warnings: result.warnings,
    } as unknown as Record<string, unknown>,
    actualCost: accumulateStepCost(costBefore, agentCostUsd),
  })
  if (agentCostUsd > 0) {
    await logStepCost(
      step.id,
      "edit_plan",
      mapStepKeyToService("edit_plan", null),
      agentCostUsd,
      videoId,
      resolveEditPlanModelId(input.profile, collectedUsages),
      { attempt, estimated },
    )
  }
  for (const warning of result.warnings) await appendStepLog(step.id, warning)
  await appendStepLog(
    step.id,
    `План монтажа готов: ${result.shots.length} кадров, статус "${result.status}", вызовов модели ${result.modelCallCount}, `
    + `ledger $${agentCostUsd.toFixed(4)}, прогноз фонов $${result.plannedMediaCostUsd.toFixed(4)}`,
  )

  return { status: result.status, shots: result.shots, costUsd: agentCostUsd, plannedMediaCostUsd: result.plannedMediaCostUsd, warnings: result.warnings }
}

// ─── Шаг 3d (audio-first): медиа фона на кадр ──────────────────

export interface VideoShotBackgroundInput {
  videoId: number
  /** Отпечаток трека — часть ключа кэша, тем же приёмом, что у edit_plan. */
  trackFingerprint: string
  format: "portrait" | "landscape"
  renderQuality: string
  profile: ResolvedEditProfile
  /** StoryPlan.globalVisualSystem.stylePrompt — единый стиль ролика для промптов фона. */
  visualStyle: string | null
  appName: string | null
  imageModelId: string
  videoModelId: string
  /**
   * Текст сцены по её `order` — контекст смысла для промпта фона.
   * ОБЯЗАТЕЛЕН: `PlannedShotRow` знает только `sceneOrder`, самого текста в
   * `VideoShot` нет, а промпт «под кадром звучит …» без него выродится в одну
   * идею. Источник — `videoPlan.scenes` (`spokenLine` либо `voiceoverLine`),
   * тот же, из которого строился трек.
   */
  sceneTextByOrder: ReadonlyMap<number, string>
}

export interface VideoShotBackgroundResult {
  status: "completed" | "degraded"
  renderedCount: number
  reusedCount: number
  costUsd: number
  warnings: string[]
}

interface ShotBackgroundImageResult { localPath: string, costUsd: number }
interface ShotBackgroundVideoResult { localPath: string, costUsd: number, effectiveDurationSec: number }

export interface ShotBackgroundStepDeps {
  /** Агент промптов (Task 3) — единственный платный вызов Anthropic шага, один на все кадры. */
  planPrompts: (input: ShotPromptInput) => Promise<ShotPromptResult>
  /** Платная генерация картинки под кадр (flux-dev, capability text_to_image). */
  generateImage: (args: { order: number, prompt: string, outputPath: string }) => Promise<ShotBackgroundImageResult>
  /** Платная генерация генеративного видео под кадр (Kling, capability text_to_video). */
  generateVideo: (args: { order: number, prompt: string, billedSec: number, outputPath: string }) => Promise<ShotBackgroundVideoResult>
  /** Бесплатная материализация библиотеки/скрина — Task 2. */
  media: ShotMediaDeps
}

function shotBackgroundExt(kind: ShotBackgroundAction["kind"]): string {
  return kind === "video" ? "mp4" : "png"
}

interface ShotBackgroundSnapshot {
  cacheKey: string
  status: "completed" | "degraded"
  warnings: string[]
}

function readShotBackgroundSnapshot(snapshot: unknown): ShotBackgroundSnapshot | null {
  const value = snapshot as Partial<ShotBackgroundSnapshot> | null
  if (!value || typeof value.cacheKey !== "string") return null
  return {
    cacheKey: value.cacheKey,
    status: value.status === "degraded" ? "degraded" : "completed",
    warnings: Array.isArray(value.warnings) ? (value.warnings as string[]) : [],
  }
}

/**
 * Ключ кэша шага: отпечаток трека + отсортированный отпечаток кадров (order,
 * background, backgroundClipId, appReferenceId, idea) + format + renderQuality
 * + id модели картинок + id модели видео + `visualStyle`/`appName`/
 * `llmModelId` (Ruling I-2 ре-ревью — все трое реально меняют РЕЗУЛЬТАТ
 * промпта фона, `agents/shot-background-prompt-agent.ts`, и были забыты) +
 * планинг-релевантные поля профиля. Сортировка по order — тем же приёмом,
 * что у `editPlanCacheKey`: порядок enumeration из БД не гарантирован и не
 * должен решать, совпал кэш или нет.
 *
 * `generativeVideoResolution` в ключе НЕТ, хотя поле профиля существует и
 * влияет на генеративное видео по смыслу настройки (Ruling I-3 ре-ревью):
 * `generateVideo` (см. ниже) собирает `TextToVideoInput` для Kling, а
 * `mapInput` спеки (`model-specs.ts:400-410`) читает только `prompt/
 * duration/aspect_ratio/negative_prompt` — `resolution` там не принимается
 * вовсе, то есть исполнение поле физически не может учесть. Тот же вывод,
 * что уже сделан для ПЛАНИРОВАНИЯ у `editPlanCacheKey`/`planningRelevantProfile`
 * (`:2615-2621`, комментарий там ровно про эту ошибку), только подтверждённый
 * заново для ИСПОЛНЕНИЯ: держать в ключе поле, которое ничего не меняет —
 * платить за перезапуск агента промптов без единой причины.
 */
function shotBackgroundCacheKey(input: {
  trackFingerprint: string
  shots: readonly { order: number, background: string, backgroundClipId: string | null, appReferenceId: string | null, idea: string | null }[]
  format: string
  renderQuality: string
  imageModelId: string
  videoModelId: string
  visualStyle: string | null
  appName: string | null
  profile: ResolvedEditProfile
}): string {
  const shotsFingerprint = [...input.shots]
    .sort((a, b) => a.order - b.order)
    .map(s => ({ order: s.order, background: s.background, backgroundClipId: s.backgroundClipId, appReferenceId: s.appReferenceId, idea: s.idea }))
  return JSON.stringify({
    trackFingerprint: input.trackFingerprint,
    shots: shotsFingerprint,
    format: input.format,
    renderQuality: input.renderQuality,
    imageModelId: input.imageModelId,
    videoModelId: input.videoModelId,
    visualStyle: input.visualStyle,
    appName: input.appName,
    llmModelId: input.profile.llmModelId,
    profile: {
      imageGenerationEnabled: input.profile.imageGenerationEnabled,
      generativeVideoEnabled: input.profile.generativeVideoEnabled,
      generativeVideoBudgetUsd: input.profile.generativeVideoBudgetUsd,
    },
  })
}

/**
 * ВХОДЫ, из которых полностью определяется медиа-файл фона кадра: всё, что
 * уходит агенту промптов (`agents/shot-background-prompt-agent.ts`
 * `buildUserPrompt`), плюс параметры самой генерации (размер кадра и модель).
 */
interface ShotAssetInputs {
  idea: string | null
  sceneText: string | null
  /** Округлена так же, как её видит агент промптов (`durationSec.toFixed(1)`). */
  durationSec: number
  visualStyle: string | null
  appName: string | null
  format: string
  renderQuality: string
  llmModelId: string | null
  /** Модель, которая рисует ИМЕННО этот кадр: картиночная либо видео. */
  mediaModelId: string
}

/**
 * Идемпотентность НА КАДР, второй уровень (требование брифа, приём
 * `runImageGeneration`): `prisma.videoAsset.prompt` хранит отпечаток «под
 * каким решением этот файл был произведён» — действие (kind + id/billedSec)
 * плюс, для `image`/`video`, ВХОДЫ этого решения (`ShotAssetInputs`).
 *
 * Считается по ВХОДАМ, а не по тексту промпта (Critical 1 финального ревью
 * ветки). Прежняя версия клала в отпечаток РЕАЛЬНЫЙ текст, ушедший
 * провайдеру, — но текст приходит от модели, а `callAnthropicAgent` не задаёт
 * `temperature` (дефолт 1.0), то есть один и тот же вход даёт РАЗНЫЙ текст.
 * Следствие было денежным: любой промах ОБЩЕГО ключа шага
 * (`shotBackgroundCacheKey`) — секундная сетевая ошибка на ОДНОМ кадре,
 * правка `idea` одного кадра, ручной перезапуск — перерисовывал и
 * ПЕРЕОПЛАЧИВАЛ каждый кадр: порядка $1 вместо обещанных $0.003. Отпечаток по
 * входам детерминирован по построению и от выхода модели не зависит вовсе.
 *
 * Не одна `idea`: `idea` — только ОДИН из входов промпта, рядом ещё
 * `sceneText`/`visualStyle`/`appName`/`format`/длительность кадра, а размер
 * картинки задаёт ещё и `renderQuality`. Смена ЛЮБОГО из них меняет
 * произведённый файл, поэтому в отпечатке они все — перечисленные явно, а не
 * транзитивно через текст, который мог измениться и сам по себе.
 *
 * `library`/`app_screen`/`none` промпта не имеют вовсе — `inputs: null`,
 * файл целиком определяется `action` (там уже есть id источника).
 */
function shotAssetFingerprint(action: ShotBackgroundAction, inputs: ShotAssetInputs | null): string {
  return JSON.stringify({ action, inputs })
}

async function defaultShotFileExists(path: string): Promise<boolean> {
  const { access } = await import("node:fs/promises")
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const defaultShotMediaDeps: ShotMediaDeps = {
  downloadToFile: async (storageKey, localPath) => { await getStorageDriver().downloadToFile(storageKey, localPath) },
  fileExists: defaultShotFileExists,
  ensureDir: async (dirPath) => { await ensureDir(dirPath) },
}

/**
 * Шаг `shot_background`: медиа фона НА КАДР — самый денежный шаг маршрута
 * «монтаж от звука» (§7 спеки). Канон — `runVideoTranscription`/`runVideoEditPlan`
 * выше в этом файле: `ensureStep` → кэш по отпечатку → `updateStep` →
 * `logStepCost`/`mapStepKeyToService`, деньги списываются, только если
 * `attemptCount` реально вырос.
 *
 * Правила выбора источника — в `planShotBackgroundExecution`
 * (`edit-plan/shot-background-runner.ts`, переиспользует `pickBackgroundSource`
 * из плана монтажа); этот раннер только материализует решение и платит за него.
 *
 * Идемпотентность — ДВА уровня:
 *  1. шаг целиком: ключ кэша в `outputSnapshot`, совпал — ни провайдер картинок,
 *     ни агент промптов не дёргаются, `VideoAsset` не создаются;
 *  2. на кадр: `VideoAsset.prompt` несёт отпечаток решения ЭТОГО кадра
 *     (`shotAssetFingerprint`) — смена `idea` промахивает кэш ровно его,
 *     остальные кадры переиспользуют файл без похода к провайдеру.
 *
 * Деградация исполнения — НА КАДР: провайдер отказал уже ПОСЛЕ того, как
 * `planShotBackgroundExecution` выбрал платный источник → кадр деградирует до
 * `background: "none"` с названной причиной, а обработка остальных кадров
 * продолжается (требование брифа «деградация до none при любом отказе
 * исполнения»). Шаг падает целиком, только если НИ ОДИН кадр не получил ни
 * фона, ни ведущего — §10: под речь совсем нечего показывать.
 */

/**
 * Пишет расход шага в ledger, СКЛАДЫВАЯ картинки и генеративное видео в ОДНУ
 * строку, если обе модели резолвятся в один сервис (ruling C-1 ре-ревью).
 *
 * `logStepCost` дедуплицирует по `(videoId, stepKey, service, attempt)` — БЕЗ
 * модели (`cost-ledger.ts:67-81`). У flux-dev и Kling сегодня один сервис
 * (`"replicate"`), и смешанный кадровый план (картинки + видео в одной
 * попытке — норма, а не край: потолок §7 сам деградирует часть видео в
 * картинки) писал ВТОРУЮ строку под тем же ключом дедупа, и она молча
 * проглатывалась — терялась именно дорогая половина (Kling).
 *
 * Расширение общего дедупа `cost-ledger.ts` до `(…, model)` — тоже рабочий
 * вариант (честнее: сохранил бы раскладку по модели), но задет был бы общий
 * модуль со своей сьютой тестов дедупа (`cost-ledger-attempt-dedupe.spec.ts`,
 * `cost-ledger-attempt-write.spec.ts`) ради одного шага. Складывание в одну
 * строку — локально, не трогает `cost-ledger.ts`, и целостность СУММЫ (что
 * реально требуется — burn-rate не должен занижаться) важнее раскладки по
 * модели НА УРОВНЕ ledger-строки: раскладка НА КАДР не теряется, она остаётся
 * в `VideoShot.costUsd` каждой отдельной строки таблицы кадров.
 *
 * Если сервисы РАЗНЫЕ (сегодня недостижимо, но не исключено на будущее —
 * например, картинки на Replicate, видео на fal) — пишутся две независимые
 * строки, дедуп между ними физически не пересекается.
 */
async function logShotBackgroundMediaCosts(
  stepId: number,
  videoId: number,
  attempt: number,
  imageModelId: string,
  imageCostUsd: number,
  videoModelId: string,
  videoCostUsd: number,
): Promise<void> {
  const imageService = mapStepKeyToService("shot_background", imageModelId)!
  const videoService = mapStepKeyToService("shot_background", videoModelId)!

  if (imageCostUsd > 0 && videoCostUsd > 0 && imageService === videoService) {
    await logStepCost(
      stepId, "shot_background", imageService, imageCostUsd + videoCostUsd, videoId,
      imageCostUsd >= videoCostUsd ? imageModelId : videoModelId,
      { attempt },
    )
    return
  }
  if (imageCostUsd > 0) {
    await logStepCost(stepId, "shot_background", imageService, imageCostUsd, videoId, imageModelId, { attempt })
  }
  if (videoCostUsd > 0) {
    await logStepCost(stepId, "shot_background", videoService, videoCostUsd, videoId, videoModelId, { attempt })
  }
}

export async function runShotBackgrounds(
  input: VideoShotBackgroundInput,
  deps: Partial<ShotBackgroundStepDeps> = {},
): Promise<VideoShotBackgroundResult> {
  const { videoId } = input
  const step = await ensureStep(videoId, "shot_background", STEP_ORDER.indexOf("shot_background"))

  const shotsRaw = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
  if (shotsRaw.length === 0) {
    throw new Error(`Фоны кадров: у ролика ${videoId} нет ни одного кадра плана монтажа — производить нечего`)
  }

  const cacheKey = shotBackgroundCacheKey({
    trackFingerprint: input.trackFingerprint,
    shots: shotsRaw,
    format: input.format,
    renderQuality: input.renderQuality,
    imageModelId: input.imageModelId,
    videoModelId: input.videoModelId,
    visualStyle: input.visualStyle,
    appName: input.appName,
    profile: input.profile,
  })

  if (isStepCompleted(step) && step.outputSnapshot) {
    const cached = readShotBackgroundSnapshot(step.outputSnapshot)
    if (cached && cached.cacheKey === cacheKey) {
      await appendStepLog(step.id, `Фоны кадров для этого плана уже готовы (${shotsRaw.length} кадров) — повторной оплаты нет`)
      return { status: cached.status, renderedCount: 0, reusedCount: shotsRaw.length, costUsd: 0, warnings: cached.warnings }
    }
  }

  const attempt = stepAttemptForLedger(step.attemptCount + 1)
  const costBefore = step.actualCost
  await updateStep(step.id, { status: "running", startedAt: new Date(), attemptCount: attempt })
  await updateVideoStatus(videoId, "generating_images", { currentStep: "shot_background" })

  const assetsDir = getAssetsDir(videoId)
  await ensureDir(assetsDir)

  // Ставки — из спек моделей, литералов цены в коде нет.
  const videoBilling = replicateVideoBilling()
  const imageSpec = findMediaSpec(input.imageModelId) ?? findMediaSpec("replicate:flux-dev")
  const imageModelAvailable = imageSpec !== null
  const imageGenerationAllowed = input.profile.imageGenerationEnabled && imageModelAvailable
  const imageUsd = imageSpec
    ? estimateMediaCost(imageSpec, { images: 1, megapixels: imageMegapixels(input.format, input.renderQuality) })
    : 0
  if (!imageGenerationAllowed) {
    await appendStepLog(
      step.id,
      input.profile.imageGenerationEnabled
        ? `Модель картинок "${input.imageModelId}" не найдена в реестре — генерация недоступна в этом прогоне, кадры без фона отдаются ведущему (§10)`
        : `Генерация картинки выключена профилем монтажа (imageGenerationEnabled=false) — кадры без библиотечного/платного фона отдаются ведущему (§10)`,
    )
  }

  // Существование ссылок на библиотеку/скрины ПРОВЕРЯЕТСЯ ЗАНОВО на исполнении,
  // а не наследуется из решения edit_plan: между планом и исполнением фон мог
  // деактивироваться (см. докстринг shot-background-runner.ts).
  const libraryIds = [...new Set(shotsRaw.map(s => s.backgroundClipId).filter((x): x is string => x !== null))]
  const screenIds = [...new Set(shotsRaw.map(s => s.appReferenceId).filter((x): x is string => x !== null))]
  const [libraryClips, appScreens] = await Promise.all([
    libraryIds.length > 0
      ? prisma.backgroundClip.findMany({ where: { id: { in: libraryIds }, isActive: true } })
      : Promise.resolve([] as Awaited<ReturnType<typeof prisma.backgroundClip.findMany>>),
    screenIds.length > 0
      ? prisma.appReferenceImage.findMany({ where: { id: { in: screenIds } } })
      : Promise.resolve([] as Awaited<ReturnType<typeof prisma.appReferenceImage.findMany>>),
  ])
  const libraryClipById = new Map(libraryClips.map(c => [c.id, c]))
  const appScreenById = new Map(appScreens.map(s => [s.id, s]))

  const rows: PlannedShotRow[] = shotsRaw.map(s => ({
    order: s.order,
    startSec: s.startSec,
    endSec: s.endSec,
    sceneOrder: s.sceneOrder,
    foreground: s.foreground,
    background: s.background,
    backgroundClipId: s.backgroundClipId,
    appReferenceId: s.appReferenceId,
    idea: s.idea,
    pipEnabled: s.pipEnabled,
  }))

  const plan = planShotBackgroundExecution({
    shots: rows,
    imageUsd,
    imageGenerationAllowed,
    generativeVideoEnabled: input.profile.generativeVideoEnabled,
    generativeVideoBudgetUsd: input.profile.generativeVideoBudgetUsd,
    generativeVideoUsdPerSec: videoBilling.usdPerSecond,
    minGenerativeVideoSec: REPLICATE_KLING_16_DURATIONS[0]!,
    maxGenerativeVideoSec: REPLICATE_KLING_16_DURATIONS[1]!,
    knownBackgroundIds: new Set(libraryClipById.keys()),
    knownAppScreenIds: new Set(appScreenById.keys()),
  })
  for (const warning of plan.warnings) await appendStepLog(step.id, warning)

  const shotById = new Map(shotsRaw.map(s => [s.order, s]))

  /** Реплика, которая звучит под кадром, — вход и промпта, и отпечатка кадра. */
  const sceneTextForShot = (shot: { sceneOrder: number | null }): string | null =>
    shot.sceneOrder !== null ? input.sceneTextByOrder.get(shot.sceneOrder) ?? null : null

  const planPrompts = deps.planPrompts ?? planShotBackgroundPrompts
  const generateImage = deps.generateImage ?? (async (args) => {
    const imageRoute = resolveMediaRoute("text_to_image", input.imageModelId)
    const isLowQuality = input.renderQuality === "low"
    const size = input.format === "portrait"
      ? { width: isLowQuality ? 720 : 1080, height: isLowQuality ? 1280 : 1920 }
      : { width: isLowQuality ? 1280 : 1920, height: isLowQuality ? 720 : 1080 }
    const task = await runMediaTask({
      capability: "text_to_image",
      spec: imageRoute.primary,
      fallbackSpec: imageRoute.fallback,
      input: { prompt: args.prompt, width: size.width, height: size.height, count: 1 },
      videoId,
      stepId: step.id,
      unitKey: `shot_${args.order}_bg`,
      sceneOrder: args.order,
      outputPath: args.outputPath,
    })
    return { localPath: task.localPath, costUsd: task.costUsd }
  })
  const generateVideo = deps.generateVideo ?? (async (args) => {
    const videoRoute = resolveMediaRoute("text_to_video", input.videoModelId)
    const aspectRatio = input.format === "portrait" ? "9:16" : "16:9"
    const task = await runMediaTask({
      capability: "text_to_video",
      spec: videoRoute.primary,
      fallbackSpec: videoRoute.fallback,
      input: { prompt: args.prompt, durationSec: args.billedSec, aspectRatio, withAudio: false },
      videoId,
      stepId: step.id,
      unitKey: `shot_${args.order}_bg`,
      sceneOrder: args.order,
      outputPath: args.outputPath,
    })
    return { localPath: task.localPath, costUsd: task.costUsd, effectiveDurationSec: task.effectiveDurationSec ?? args.billedSec }
  })
  const media = deps.media ?? defaultShotMediaDeps

  let imageCostUsd = 0
  let videoCostUsd = 0
  let renderedCount = 0
  let reusedCount = 0
  const executionWarnings: string[] = []

  // Цена вызова агента промптов считается ОДИН раз и переживает и happy-path,
  // и падение ниже — тем же приёмом, что `priceEditPlanModelCall` у edit_plan.
  let promptPriced: { costUsd: number, measured: boolean } | null = null
  const ensurePromptPriced = async (usage: EditPlanModelUsage | null): Promise<{ costUsd: number, measured: boolean }> => {
    if (promptPriced) return promptPriced
    promptPriced = plan.promptOrders.length > 0
      ? await priceEditPlanModelCall(usage, step.id)
      : { costUsd: 0, measured: true }
    return promptPriced
  }
  // Объявлена ВНЕ try, ЯЩИКОМ, а не голым `let`: reportUsage синхронный (до
  // парсинга/validate внутри planPrompts) и обязан пережить исключение
  // planPrompts — иначе catch не увидит уже полученный usage и спишет
  // резервную оценку вместо измеренной цены, а то и вовсе ничего (падение
  // planShotBackgroundPrompts, ещё до ensurePromptPriced в happy-path).
  // Ящик (`{ value }`), а не `let promptUsage`: присвоение внутри onUsage —
  // единственное место, где значение меняется, и TS для голого `let`,
  // изменяемого ТОЛЬКО из вложенного замыкания, сужает тип во всех точках
  // чтения ВНЕ замыкания до типа инициализатора (`null`), а не до объявленного
  // `EditPlanModelUsage | null` — чтение свойства объекта этой узкой
  // (некорректной для данного случая) эвристике не подвержено.
  const promptUsageBox: { value: EditPlanModelUsage | null } = { value: null }

  try {
    // Промпты — ОДНИМ вызовом на все кадры из plan.promptOrders.
    const promptsByOrder = new Map<number, string>()
    if (plan.promptOrders.length > 0) {
      const requests: ShotPromptRequest[] = plan.promptOrders.map((order) => {
        const shot = shotById.get(order)!
        return { order, idea: shot.idea, sceneText: sceneTextForShot(shot), durationSec: shot.endSec - shot.startSec }
      })
      const promptResult = await planPrompts({
        shots: requests,
        visualStyle: input.visualStyle,
        appName: input.appName,
        format: input.format,
        model: input.profile.llmModelId,
        onUsage: (usage) => { promptUsageBox.value = usage },
      })
      for (const p of promptResult.prompts) promptsByOrder.set(p.order, p.prompt)
    }
    await ensurePromptPriced(promptUsageBox.value)

    let anyVisible = false

    for (const item of plan.items) {
      const shot = shotById.get(item.order)!
      let finalAction: ShotBackgroundAction = item.action
      let finalDegradeReason = item.degradeReason
      let costForShot: number | undefined // undefined = не трогать VideoShot.costUsd (переиспользован)
      // Файл фона ЭТОГО кадра реально сменился на диске (Critical 2 финального
      // ревью): собранный кадр `shot_N_composed.mp4` от прошлого прогона
      // больше не соответствует своему фону и обязан быть пересобран.
      let backgroundChanged = false

      if (item.action.kind === "none") {
        costForShot = 0
        // "none" по решению планирования — стереть возможный СТАРЫЙ ассет:
        // план сменился с "image"/"video" на "none" между прогонами.
        const stale = await prisma.videoAsset.findFirst({ where: { videoId, type: "shot_background" as never, order: item.order } })
        if (stale) {
          await prisma.videoAsset.delete({ where: { id: stale.id } }).catch(() => {})
          backgroundChanged = true
        }
      } else {
        // Отпечаток — от ВХОДОВ решения, а не от текста промпта (Critical 1
        // финального ревью): текст недетерминирован, входы — нет.
        const assetInputs: ShotAssetInputs | null = item.action.kind === "image" || item.action.kind === "video"
          ? {
              idea: shot.idea,
              sceneText: sceneTextForShot(shot),
              durationSec: Number((shot.endSec - shot.startSec).toFixed(1)),
              visualStyle: input.visualStyle,
              appName: input.appName,
              format: input.format,
              renderQuality: input.renderQuality,
              llmModelId: input.profile.llmModelId,
              mediaModelId: item.action.kind === "image" ? input.imageModelId : input.videoModelId,
            }
          : null
        const fingerprint = shotAssetFingerprint(item.action, assetInputs)
        const outputPath = join(assetsDir, `shot_${item.order}_bg.${shotBackgroundExt(item.action.kind)}`)
        const existingAsset = await prisma.videoAsset.findFirst({
          where: { videoId, type: "shot_background" as never, order: item.order },
        })
        const reusable = !!existingAsset
          && existingAsset.prompt === fingerprint
          && await media.fileExists(existingAsset.filePath ?? outputPath)

        if (reusable) {
          reusedCount += 1
          // costForShot остаётся undefined — VideoShot.costUsd не трогаем,
          // деньги за этот кадр уже отражены прошлым прогоном.
        } else {
          try {
            let localPath: string
            let generatedCost = 0
            // Вид медиа по факту создания — единственный писатель этого поля
            // для типа `shot_background` (Task 5, фикс-раунд 1): раньше
            // `assetData` его не заполняла вовсе, и `shotBackgroundIsStill`
            // ниже по стеку (Task 5, композиция) была вынуждена откатываться
            // на расширение файла. Литерал по kind — тот же приём, что уже
            // используют соседние типы ассетов (`persistExtendedClipAsset`
            // жёстко пишет "video/mp4"); для library/app_screen источник
            // может знать РЕАЛЬНЫЙ mime (BackgroundClip.mimeType/
            // AppReferenceImage.mimeType) — он точнее жёсткого дефолта по
            // kind и предпочитается, когда есть.
            let contentType: string
            switch (item.action.kind) {
              case "library": {
                const clip = libraryClipById.get(item.action.backgroundClipId)
                if (!clip) throw new Error(`фон "${item.action.backgroundClipId}" не найден или деактивирован`)
                const ref: BackgroundClipRef = { id: clip.id, storageKey: clip.storageKey, sha1: clip.sha1, mimeType: clip.mimeType, kind: clip.kind }
                localPath = await materializeBackgroundClip(ref, assetsDir, media)
                contentType = clip.mimeType ?? (clip.kind === "image" ? "image/png" : "video/mp4")
                break
              }
              case "app_screen": {
                const screen = appScreenById.get(item.action.appReferenceId)
                if (!screen) throw new Error(`скрин "${item.action.appReferenceId}" не найден`)
                const ref: AppReferenceRef = { id: screen.id, appId: screen.appId, sha1: screen.sha1, mimeType: screen.mimeType, storageKey: screen.storageKey }
                localPath = await materializeAppReference(ref, assetsDir, media)
                // Скрин приложения — всегда картинка по определению модели.
                contentType = screen.mimeType ?? "image/png"
                break
              }
              case "image": {
                const prompt = promptsByOrder.get(item.order)
                if (!prompt) throw new Error("промпт не получен от агента")
                const result = await generateImage({ order: item.order, prompt, outputPath })
                localPath = result.localPath
                generatedCost = result.costUsd
                imageCostUsd += result.costUsd
                contentType = "image/png"
                break
              }
              case "video": {
                const prompt = promptsByOrder.get(item.order)
                if (!prompt) throw new Error("промпт не получен от агента")
                const result = await generateVideo({ order: item.order, prompt, billedSec: item.action.billedSec, outputPath })
                localPath = result.localPath
                generatedCost = result.costUsd
                videoCostUsd += result.costUsd
                contentType = "video/mp4"
                break
              }
            }
            renderedCount += 1
            costForShot = generatedCost
            backgroundChanged = true

            const assetData = {
              filePath: localPath,
              prompt: fingerprint,
              duration: item.action.kind === "video" ? Math.round(item.action.billedSec) : null,
              contentType,
            }
            if (existingAsset) {
              await prisma.videoAsset.update({ where: { id: existingAsset.id }, data: assetData })
            } else {
              await prisma.videoAsset.create({ data: { videoId, type: "shot_background" as never, order: item.order, ...assetData } })
            }
          } catch (error) {
            // Деградация до none при отказе ИСПОЛНЕНИЯ (не путать с деградацией
            // ПЛАНИРОВАНИЯ выше — она уже отражена в item.degradeReason):
            // провайдер отказал уже ПОСЛЕ того, как planShotBackgroundExecution
            // выбрал платный источник. Обработка остальных кадров продолжается.
            const message = error instanceof Error ? error.message : String(error)
            finalAction = { kind: "none" }
            finalDegradeReason = finalDegradeReason
              ? `${finalDegradeReason} — сверх этого исполнение отказало: ${message}`
              : `Не удалось получить фон кадра: ${message}`
            costForShot = 0
            executionWarnings.push(`Кадр ${item.order}: ${finalDegradeReason}`)
            if (existingAsset) {
              await prisma.videoAsset.delete({ where: { id: existingAsset.id } }).catch(() => {})
              backgroundChanged = true
            }
          }
        }
      }

      if (finalAction.kind !== "none" || shot.foreground === "presenter") anyVisible = true

      await prisma.videoShot.update({
        where: { id: shot.id },
        data: {
          status: finalDegradeReason ? "degraded" : "completed",
          degradeReason: finalDegradeReason,
          // Факт (ruling ре-ревью, сомнение Б) — что РЕАЛЬНО произведено для
          // этого кадра, независимо от того, что запросил план (`background`,
          // не трогаем никогда). Пишется в ту же строку update, которая здесь
          // уже была, — цена поля ровно одна строка, как и обещано в ревью.
          backgroundActual: finalAction.kind,
          ...(costForShot === undefined ? {} : { costUsd: costForShot }),
          // Critical 2 финального ревью ветки: собранный кадр
          // (`shot_N_composed.mp4`) не является `VideoAsset` и ни одним
          // каскадом сброса не сносится, а `composeVideoShots` переиспускает
          // его по ключу «путь + status=completed + файл существует» —
          // содержимого этот ключ не кодирует. Пока `assetPath` не обнулялся,
          // оператор перезапускал платный шаг фонов, ПЛАТИЛ за новые
          // картинки/клипы и получал ролик байт в байт прежний, без единой
          // ошибки. Обнуляем ТОЛЬКО у кадров, чей фон реально сменился:
          // переиспользованные кадры сохраняют `assetPath` и ffmpeg по ним
          // повторно не гоняется — идемпотентность Ruling S8-7 цела, соседи
          // остаются оплаченными.
          ...(backgroundChanged ? { assetPath: null } : {}),
        },
      })
    }

    // §10: если НИ ОДИН кадр не получил ни фона, ни ведущего — под речь
    // совсем нечего показывать, ролик не должен дойти до «готов» так.
    if (!anyVisible) {
      throw new Error(
        `Фоны кадров ролика ${videoId}: ни один кадр не получил фона, а ведущего — тоже ни на одном (§10), `
        + `показывать под речь нечего`,
      )
    }

    const { costUsd: promptCostUsd, measured: promptMeasured } = await ensurePromptPriced(promptUsageBox.value)
    const promptModelId: string | null = promptUsageBox.value === null ? null : promptUsageBox.value.model
    const totalCostUsd = imageCostUsd + videoCostUsd + promptCostUsd
    const overallStatus: "completed" | "degraded" = executionWarnings.length > 0 || plan.warnings.length > 0 ? "degraded" : "completed"
    const warnings = [...plan.warnings, ...executionWarnings]

    // Ruling I-1 ре-ревью: ключ кэша сохраняется, ТОЛЬКО если деградация (если
    // она есть) — планировочная (детерминированная, повтор ничего не изменит).
    // Деградация ИСПОЛНЕНИЯ (сеть/пятисотка провайдера) — событие среды, а не
    // свойство материала (тот же разбор, что `DETERMINISTIC_SKIP_REASONS` в
    // `presenter/lip-sync-progress.ts` делает для причин пропуска lip-sync):
    // кадр, потерявший фон из-за секундного сбоя, не должен киснуть без него
    // до ручного перезапуска шага. `null` здесь — не мусор, а сознательный
    // сигнал: `readShotBackgroundSnapshot` его не примет за валидный кэш
    // (`typeof cacheKey !== "string"`), следующий прогон пересчитает ВСЁ
    // заново, но по деньгам это дёшево — успешные кадры защищены отпечатком
    // НА кадр и переиспользуются бесплатно, платится заново только один
    // вызов агента промптов.
    const cacheKeyToStore = executionWarnings.length > 0 ? null : cacheKey

    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      errorMessage: null,
      outputSnapshot: { cacheKey: cacheKeyToStore, status: overallStatus, warnings } as unknown as Record<string, unknown>,
      actualCost: accumulateStepCost(costBefore, totalCostUsd),
    })
    await logShotBackgroundMediaCosts(step.id, videoId, attempt, input.imageModelId, imageCostUsd, input.videoModelId, videoCostUsd)
    if (promptCostUsd > 0) {
      await logStepCost(step.id, "shot_background", "anthropic", promptCostUsd, videoId, promptModelId, { attempt, estimated: !promptMeasured })
    }
    await appendStepLog(
      step.id,
      `Фоны кадров готовы: ${renderedCount} нарисовано, ${reusedCount} переиспользовано, `
      + `$${totalCostUsd.toFixed(4)} (картинки $${imageCostUsd.toFixed(4)}, видео $${videoCostUsd.toFixed(4)}, промпты $${promptCostUsd.toFixed(4)})`,
    )

    return { status: overallStatus, renderedCount, reusedCount, costUsd: totalCostUsd, warnings }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Частичное падение: то, что уже оплачено (картинки/видео до сбоя, и
    // вызов агента промптов, если он состоялся), обязано остаться в ledger —
    // тем же приёмом, что `chargePartialStepOnFailure` в video-pipeline.ts,
    // только СВОИМ накопителем: этот шаг сам себя списывает целиком, а не
    // через внешнего вызывающего.
    //
    // Ruling I-4 ре-ревью: весь учёт ниже обёрнут В СВОЙ try/catch, тем же
    // приёмом, что `chargePartialStepOnFailure` (`video-pipeline.ts`) —
    // падение записи расхода (обрыв БД, конфликт) не должно подменить
    // ИСХОДНУЮ причину отказа шага, которая летит наружу из этого catch.
    try {
      const { costUsd: promptCostUsd, measured: promptMeasured } = await ensurePromptPriced(promptUsageBox.value)
      const promptModelId: string | null = promptUsageBox.value === null ? null : promptUsageBox.value.model
      const totalCostUsd = imageCostUsd + videoCostUsd + promptCostUsd
      await updateStep(step.id, {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: message.slice(0, 1000),
        actualCost: accumulateStepCost(costBefore, totalCostUsd),
      })
      await logShotBackgroundMediaCosts(step.id, videoId, attempt, input.imageModelId, imageCostUsd, input.videoModelId, videoCostUsd)
      if (promptCostUsd > 0) {
        await logStepCost(step.id, "shot_background", "anthropic", promptCostUsd, videoId, promptModelId, { attempt, estimated: !promptMeasured })
      }
      await appendStepLog(
        step.id,
        `Фоны кадров не построены: ${message} (нарисовано до сбоя: ${renderedCount}, `
        + `переиспользовано: ${reusedCount}, оплачено: $${totalCostUsd.toFixed(4)})`,
      )
    } catch { /* учёт не должен подменять причину падения шага */ }
    throw error
  }
}

// ─── Шаг 4: Генерация музыки ───────────────────────────────────

export async function runMusicGeneration(
  videoId: number,
  musicEnabled: boolean,
  musicMood: string | null,
  musicDuration: number | null,
  videoPlan?: StoryDrivenVideoPlan | null,
): Promise<string | null> {
  const step = await ensureStep(videoId, "music_generation", 4)

  if (!musicEnabled) {
    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
    })
    await appendStepLog(step.id, "Музыка отключена в настройках")
    return null
  }

  if (isStepCompleted(step) && step.outputSnapshot) {
    const output = step.outputSnapshot as { musicPath: string | null }
    if (output.musicPath) return output.musicPath
  }

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: step.attemptCount + 1,
  })

  const effectiveDuration = videoPlan?.totalDurationSec
    ? Math.ceil(videoPlan.totalDurationSec)
    : (musicDuration || 15)

  const effectiveMood = musicMood
    || (videoPlan?.mode !== 'legacy_simple'
      ? `cinematic ${videoPlan?.globalVisualContext?.mood || 'energetic'}`
      : "energetic upbeat")

  await appendStepLog(step.id, `Генерирую музыку: mood="${effectiveMood}", duration=${effectiveDuration}s`)
  await updateVideoStatus(videoId, "generating_music", { currentStep: "music_generation" })

  try {
    const musicUrl = await generateMusic(effectiveMood, effectiveDuration)

    if (!musicUrl) {
      await updateStep(step.id, {
        status: "completed",
        finishedAt: new Date(),
        outputSnapshot: { musicPath: null },
      })
      await appendStepLog(step.id, "Mubert не вернул трек, продолжаем без музыки")
      return null
    }

    const assetsDir = getAssetsDir(videoId)
    await ensureDir(assetsDir)
    const musicPath = join(assetsDir, "music.mp3")
    await downloadFile(musicUrl, musicPath)

    const musicStorage = await uploadLocalAsset(
      musicPath,
      StorageKeys.videoMusic(videoId),
      "audio/mpeg",
    )
    const musicFileUrl = storageKeyToLegacyUrl(musicStorage.storageKey)

    const existingMusic = await prisma.videoAsset.findFirst({
      where: { videoId, type: "music" as never },
    })
    if (existingMusic) {
      await prisma.videoAsset.update({
        where: { id: existingMusic.id },
        data: { filePath: musicPath, fileUrl: musicFileUrl, ...musicStorage },
      })
    } else {
      await prisma.videoAsset.create({
        data: {
          videoId,
          type: "music" as never,
          filePath: musicPath,
          fileUrl: musicFileUrl,
          order: 99,
          ...musicStorage,
        },
      })
    }

    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      outputSnapshot: { musicPath },
    })
    await appendStepLog(step.id, "Музыка сгенерирована")

    return musicPath
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Неизвестная ошибка"
    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      outputSnapshot: { musicPath: null },
      errorMessage: msg.slice(0, 500),
    })
    await appendStepLog(step.id, `Ошибка музыки (не блокирует pipeline): ${msg}`)
    return null
  }
}

// ─── Шаг 5: Сборка видео ───────────────────────────────────────

// ─── Кадровая композиция (Task 5 плана «Сборка по кадрам», §6.3/§8) ────────
//
// Живёт внутри шага "assembly" целиком (решение контроллера, а не моё —
// см. progress.md: платных вызовов нет, отдельный ключ шага дал бы лишние
// точки регистрации ради бесплатной операции). Действует ТОЛЬКО когда у
// ролика есть строки `VideoShot` — они появляются исключительно на кадровом
// маршруте («монтаж от звука», шаг `edit_plan`); на старом маршруте таких
// строк нет никогда, и весь блок ниже не исполняется вовсе.
//
// Конкатенация готовых файлов кадров в единый ролик — задача следующей
// задачи плана (Task 6, «Сборка по кадрам, субтитры по абсолютному
// времени»). Здесь только материализация ОДНОГО файла на кадр и запись его
// пути в `VideoShot.assetPath` — интерфейсная точка, которую Task 6
// потребляет (см. таблицу конфликтов плана, пара «4 → 6»).

/**
 * Вид фона по факту на диске — а не по `VideoShot.background` (план мог
 * сказать одно, деградация исполнения дала другое, и после деградации
 * `video → image` поле плана продолжает врать — см. Task 4).
 *
 * `contentType` — решающий и первый: `runShotBackgrounds` (Task 5,
 * фикс-раунд 1) заполняет его при КАЖДОМ создании/обновлении ассета
 * `shot_background`, тем же приёмом, что и соседние типы ассетов
 * (`persistExtendedClipAsset` пишет литерал `"video/mp4"`).
 *
 * Расширение файла — фолбэк ВТОРЫМ эшелоном, а не основной путь: он
 * закрывает записи, созданные ДО этой правки (contentType=null в уже
 * существующих строках БД), и любой будущий провал классификации по
 * mime — но никогда не решает при исправно заполненном `contentType`.
 * Нераспознанное расширение (не `.mp4/.mov/.webm`) фолбэк трактует как
 * КАРТИНКУ — тот же дефолт, что уже раньше был у `shotBackgroundExt`/
 * `extFor` для незнакомого mime; проверка не должна расширяться на
 * произвольные видео-контейнеры вслепую.
 */
export function shotBackgroundIsStill(asset: { contentType: string | null, filePath: string }): boolean {
  if (asset.contentType) {
    if (asset.contentType.startsWith("video/")) return false
    if (asset.contentType.startsWith("image/")) return true
  }
  return !/\.(mp4|mov|webm)$/i.test(asset.filePath)
}

/**
 * Приводит клип lip-sync каждой сцены к длине этой сцены В ТРЕКЕ (§8):
 * длину исходника задаёт окно записи/библиотечный клип, а не кусок трека, и
 * её нигде в проекте не измеряют, кроме как здесь. Возвращает карту
 * `sceneOrder → путь`, из которой берётся `ShotSources.presenterPath`.
 *
 * Возвращаемый путь для ПРИВЕДЁННОГО (обрезанного/удержанного) клипа
 * заново брендируется `markLipSynced` — это не блуждающий каст: источник
 * уже был `LipSyncedClipPath` (гарантия §6.3), а обрезка/удержание кадра
 * не трогают ни лицо, ни порядок shot→lip-sync→PiP, на котором держится
 * сам бренд. Единственный МИНТ бренда с нуля остаётся в lip-sync-runner.ts.
 */
async function fitPresenterClipsToScenes(
  videoId: number,
  step: { id: number },
  alignedScenes: readonly AlignedScene[],
): Promise<Map<number, NonNullable<ShotSources["presenterPath"]>>> {
  const lipSyncStep = await ensureStep(videoId, "lip_sync_generation", STEP_ORDER.indexOf("lip_sync_generation"))
  const sceneRecords = readPreviousSceneRecords(lipSyncStep.outputSnapshot)
  const alignedSceneByOrder = new Map(alignedScenes.map(s => [s.order, s]))
  const assetsDir = getAssetsDir(videoId)

  const presenterPathBySceneOrder = new Map<number, NonNullable<ShotSources["presenterPath"]>>()

  for (const record of sceneRecords.values()) {
    if (!record.outputPath) continue

    const measuredSec = await probeMediaDuration(record.outputPath)
    if (measuredSec === null) {
      await appendStepLog(step.id, `Кадровый монтаж: клип сцены ${record.sceneOrder} не измеряется — ведущий этой сцены недоступен`)
      continue
    }

    const alignedScene = alignedSceneByOrder.get(record.sceneOrder)
    if (!alignedScene) {
      // Запись lip-sync без границ в ТЕКУЩЕМ выравнивании (рассинхрон
      // снапшотов) — используем клип как есть, приводить не к чему.
      presenterPathBySceneOrder.set(record.sceneOrder, record.outputPath)
      continue
    }

    const targetSec = snapSecToFrame(Math.max(0, alignedScene.endSec - alignedScene.startSec), TIMELINE_FPS)
    const diffSec = measuredSec - targetSec
    if (targetSec <= 0 || Math.abs(diffSec) <= 1 / TIMELINE_FPS) {
      presenterPathBySceneOrder.set(record.sceneOrder, record.outputPath)
      continue
    }

    const fittedPath = join(assetsDir, `scene_${record.sceneOrder}_lipsync_fit.mp4`)

    // Идемпотентность (Ruling S8-7, тот же приём, что и у composeVideoShots
    // ниже): прошлый проход уже привёл клип к длине сцены — файл на месте,
    // повторный ffmpeg (trim/hold) не нужен. Без этой проверки КАЖДЫЙ повторный
    // вызов composeVideoShots заново перекодировал бы presenter-исходник,
    // хотя сам кадр уже не пересобирается (проверено ниже).
    //
    // Существования файла НЕДОСТАТОЧНО (Important 1, фикс-раунд 1, ревью):
    // `scene_N_lipsync_fit.mp4` не регистрируется как `VideoAsset` и ничей
    // каскад сброса его не сносит, а имя файла не несёт цель. Перепланировка
    // (правка сценария, `rerunVideoStep` до `edit_plan`) даёт новый трек и
    // новые границы сцен — старый `_fit.mp4` остаётся на диске и молча
    // подставился бы под НОВУЮ (другую) цель. Сверяем измеренную длительность
    // САМОГО файла с текущим `targetSec`: не сошлось — файл устарел,
    // перегенерируем ниже, как будто его не было.
    if (await defaultShotFileExists(fittedPath)) {
      const fittedMeasuredSec = await probeMediaDuration(fittedPath)
      if (fittedMeasuredSec !== null && Math.abs(fittedMeasuredSec - targetSec) <= 1 / TIMELINE_FPS) {
        presenterPathBySceneOrder.set(record.sceneOrder, markLipSynced(fittedPath))
        continue
      }
      await appendStepLog(
        step.id,
        `Кадровый монтаж: клип сцены ${record.sceneOrder} устарел — цель ${targetSec.toFixed(3)}с, `
        + `файл ${fittedMeasuredSec === null ? "не измеряется" : `${fittedMeasuredSec.toFixed(3)}с`} — перегенерирую`,
      )
    }

    if (diffSec > 0) {
      await trimFittedClip(record.outputPath, fittedPath, targetSec)
      await appendStepLog(
        step.id,
        `Кадровый монтаж: клип сцены ${record.sceneOrder} обрезан до ${targetSec.toFixed(3)}с (было ${measuredSec.toFixed(3)}с)`,
      )
    } else {
      await holdLastFrameFittedClip(record.outputPath, fittedPath, targetSec - measuredSec)
      await appendStepLog(
        step.id,
        `Кадровый монтаж: клип сцены ${record.sceneOrder} удлинён удержанием кадра до ${targetSec.toFixed(3)}с (было ${measuredSec.toFixed(3)}с)`,
      )
    }
    presenterPathBySceneOrder.set(record.sceneOrder, markLipSynced(fittedPath))
  }

  return presenterPathBySceneOrder
}

/**
 * Допуск сверки ИЗМЕРЕННОЙ длительности собранного кадра с заявленным
 * интервалом — два кадра сетки 30fps (Important 3 финального ревью).
 *
 * Ровно на кадр шире порога добивки в `shot-compose-runner.ts`
 * (`MIN_FRAME_GAP_SEC = 1/30`): добивка срабатывает, как только файл короче
 * больше чем на кадр, значит остаток после неё меньше кадра — и честная
 * деградация здесь не может сработать на дрейфе кодека. Дрейф штатных
 * вырезок ревьюер намерил < 1 мс, так что запас не съедает защиту: реальный
 * отказ (источник вдвое короче заказа) она видит с огромным перевесом.
 */
const SHOT_MEASURED_TOLERANCE_SEC = 2 / TIMELINE_FPS

/** Один готовый кадр монтажа — вход кадрового таймлайна сборки (Task 6). */
export interface ComposedShot {
  order: number
  startSec: number
  endSec: number
  path: string
}

/**
 * Собирает по одному готовому файлу на каждый кадр (`VideoShot`) ролика:
 * фон, ведущий или их PiP-наложение. Возвращает `null`, если у ролика нет
 * ни одной строки `VideoShot` — старый маршрут не задет вовсе.
 *
 * Экспортирована (Task 6, Ruling S8-7): оркестрация — чтение `VideoShot`/
 * `VideoAsset`/снапшота lip-sync, запись `assetPath` — до этой задачи не была
 * покрыта ни одним автотестом; целевой интеграционный тест зовёт функцию
 * напрямую на реальной БД и реальном ffmpeg (см. `tests/integration/`).
 *
 * Идемпотентна: повторный вызов на кадре, который уже собран прошлым проходом
 * (`assetPath` указывает на файл с ожидаемым для текущего запуска путём,
 * `status: "completed"`, файл реально существует на диске), НЕ пересобирает
 * его заново — только считает в `composedCount` и возвращает как есть. Без
 * этого каждый повторный вызов `runAssembly` (а он не кэшируется — «Сборка
 * бесплатна» в `video-pipeline.ts`) заново прогонял бы ffmpeg по каждому
 * кадру, включая тяжёлую ветку PiP (до 180с таймаута на кадр).
 */
export async function composeVideoShots(
  videoId: number,
  step: { id: number },
  alignedScenes: readonly AlignedScene[],
  profile: ResolvedEditProfile,
  format: "portrait" | "landscape",
): Promise<{ composedCount: number, degradedCount: number, shots: ComposedShot[] } | null> {
  const shotsRaw = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
  if (shotsRaw.length === 0) return null

  await appendStepLog(step.id, `Кадровый монтаж: собираю ${shotsRaw.length} кадров (фон + ведущий + PiP)`)

  const backgroundAssetsRaw = await prisma.videoAsset.findMany({
    where: { videoId, type: "shot_background" as never },
    select: { order: true, filePath: true, contentType: true },
  })
  // Ассета нет ИЛИ файла нет на диске — фона у кадра нет: кадр уходит в
  // `mergeUnrenderableShots`, а не падает с ошибкой чтения файла на рендере.
  const backgroundByShotOrder = new Map<number, { filePath: string, contentType: string | null }>()
  for (const asset of backgroundAssetsRaw) {
    if (!asset.filePath) continue
    if (!(await defaultShotFileExists(asset.filePath))) continue
    backgroundByShotOrder.set(asset.order, { filePath: asset.filePath, contentType: asset.contentType })
  }

  const presenterPathBySceneOrder = await fitPresenterClipsToScenes(videoId, step, alignedScenes)

  const shotHasSource = (shot: (typeof shotsRaw)[number]): boolean => {
    const hasBackground = backgroundByShotOrder.has(shot.order)
    const hasPresenter = shot.sceneOrder !== null && presenterPathBySceneOrder.has(shot.sceneOrder)
    return hasBackground || hasPresenter
  }

  const { shots: effectiveShots, mergedOrders } = mergeUnrenderableShots(shotsRaw, shotHasSource)
  const shotById = new Map(shotsRaw.map(s => [s.order, s]))

  if (mergedOrders.length > 0) {
    await appendStepLog(
      step.id,
      `Кадровый монтаж: кадры без источника (${mergedOrders.join(", ")}) слиты с соседями — таймлайн не рвётся`,
    )
    for (const order of mergedOrders) {
      const donor = shotById.get(order)
      if (!donor) continue
      await prisma.videoShot.update({
        where: { id: donor.id },
        data: {
          status: "degraded",
          degradeReason: "нет ни фона, ни ведущего — интервал поглощён соседним кадром",
          assetPath: null,
        },
      })
    }
  }

  if (effectiveShots.length === 0) {
    throw new Error(
      `Кадровый монтаж ролика ${videoId}: ни у одного кадра нет ни фона, ни ведущего — под трек нечего показывать (§10)`,
    )
  }

  const canvas = format === "landscape" ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 }
  const assetsDir = getAssetsDir(videoId)
  let composedCount = 0
  let degradedCount = 0
  let reusedCount = 0
  const shots: ComposedShot[] = []

  for (const shot of effectiveShots) {
    const original = shotById.get(shot.order)!
    const outputPath = join(assetsDir, `shot_${shot.order}_composed.mp4`)

    // Идемпотентность (Ruling S8-7): кадр уже собран прошлым проходом на
    // ТОТ ЖЕ путь, запись подтверждает успех, и файл реально на диске — ffmpeg
    // на готовом кадре не перезапускаем. `runAssembly`/сборка кэша шага не
    // имеет («Сборка бесплатна» — video-pipeline.ts), значит без этой ветки
    // каждый повторный прогон заново гонял бы ffmpeg по каждому кадру,
    // включая тяжёлую ветку PiP (до 180с таймаута на кадр).
    if (
      original.assetPath === outputPath
      && original.status === "completed"
      && await defaultShotFileExists(outputPath)
    ) {
      composedCount += 1
      reusedCount += 1
      shots.push({ order: shot.order, startSec: shot.startSec, endSec: shot.endSec, path: outputPath })
      continue
    }

    const bgAsset = backgroundByShotOrder.get(shot.order) ?? null
    const presenterPath = shot.sceneOrder !== null ? presenterPathBySceneOrder.get(shot.sceneOrder) ?? null : null
    const alignedScene = shot.sceneOrder !== null
      ? alignedScenes.find(s => s.order === shot.sceneOrder)
      : undefined

    const sources: ShotSources = {
      presenterPath,
      // Смещение подотрезка внутри сцены считается от начала СЦЕНЫ в треке —
      // это `alignedScene.startSec`, а не плановый `VideoShot.startSec`
      // самого первого кадра сцены (они совпадают в штатном случае, но
      // выравнивание — источник истины по треку).
      sceneStartSec: alignedScene?.startSec ?? shot.startSec,
      backgroundPath: bgAsset?.filePath ?? null,
      backgroundIsStill: bgAsset ? shotBackgroundIsStill(bgAsset) : true,
    }

    const composition = planShotComposition({
      shot: { order: shot.order, startSec: shot.startSec, endSec: shot.endSec, pipEnabled: shot.pipEnabled, foreground: shot.foreground },
      sources,
      profile: { pipPosition: profile.pipPosition, pipSize: profile.pipSize, pipEnabled: profile.pipEnabled },
      canvasWidth: canvas.w,
      canvasHeight: canvas.h,
      fps: TIMELINE_FPS,
    })

    if (!composition) {
      // mergeUnrenderableShots уже отфильтровал такие кадры выше — сюда
      // попасть не должен, но рассинхрон источников между проходами не
      // исключён полностью, и молчаливая потеря кадра хуже явной деградации.
      await prisma.videoShot.update({
        where: { id: original.id },
        data: { status: "degraded", degradeReason: "источники кадра пропали между планированием и композицией", assetPath: null },
      })
      degradedCount += 1
      continue
    }

    try {
      await renderShotComposition({ composition, outputPath, format })

      // Important 3 финального ревью: покрытие трека дальше проверяется по
      // ЗАЯВЛЕННЫМ интервалам (`assertShotsCoverTrack`), а ffmpeg не обязан
      // выдать заказанную длительность — `-t`/`-shortest` только потолок.
      // Здесь заявленное сверяется с ИЗМЕРЕННЫМ ровно один раз, у источника:
      // `renderShotComposition` уже добила короткий файл удержанием кадра, и
      // если после этого файл ВСЁ РАВНО короче интервала — кадр деградирует
      // честно, дыру увидит `assertShotsCoverTrack`, и ролик не дойдёт до
      // «готов» короче своей речи (§10).
      const measuredSec = await probeMediaDuration(outputPath)
      if (measuredSec !== null && measuredSec < composition.durationSec - SHOT_MEASURED_TOLERANCE_SEC) {
        throw new Error(
          `собранный файл короче своего интервала: ${measuredSec.toFixed(3)}с вместо ${composition.durationSec.toFixed(3)}с `
          + "(источник кадра короче заказа, добивка удержанием кадра не помогла)",
        )
      }

      await prisma.videoShot.update({
        where: { id: original.id },
        data: { assetPath: outputPath, status: "completed", degradeReason: null },
      })
      composedCount += 1
      shots.push({ order: shot.order, startSec: shot.startSec, endSec: shot.endSec, path: outputPath })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await prisma.videoShot.update({
        where: { id: original.id },
        data: { status: "degraded", degradeReason: `композиция не удалась: ${message.slice(0, 300)}`, assetPath: null },
      })
      await appendStepLog(step.id, `Кадровый монтаж: кадр ${shot.order} не собран — ${message.slice(0, 200)}`)
      degradedCount += 1
    }
  }

  if (composedCount === 0) {
    throw new Error(`Кадровый монтаж ролика ${videoId}: ни один кадр не собрался — под трек нечего показывать (§10)`)
  }

  await appendStepLog(
    step.id,
    `Кадровый монтаж: собрано ${composedCount} кадров (из них переиспользовано ${reusedCount}), деградировало ${degradedCount}`,
  )
  // По order — тот же порядок, что и `effectiveShots`/`shotsRaw` (запрошены
  // orderBy order asc, слияние порядок не меняет), но сортируем явно: карта
  // истины для конкат-листа — этот массив, а не побочный эффект стабильности
  // цикла.
  shots.sort((a, b) => a.order - b.order)
  return { composedCount, degradedCount, shots }
}

/** Сцена сценария, у которой нужен только текст под субтитр и его раскладка. */
export interface ShotTimelineTextScene {
  order: number
  spokenLine?: string | null
  voiceoverLine?: string | null
  subtitleCopy?: string | null
  subtitlePlacement?: SubtitlePlacement
}

/** Произносимый текст сцены — реплика в кадре либо закадровая строка, пересказ как последний резерв. */
function shotTimelineTextOf(scene: ShotTimelineTextScene | undefined): { text: string, placement?: SubtitlePlacement } | undefined {
  if (!scene) return undefined
  const text = (scene.spokenLine?.trim() || scene.voiceoverLine?.trim() || scene.subtitleCopy || '').trim()
  return text.length > 0 ? { text, placement: scene.subtitlePlacement } : undefined
}

/**
 * Сопоставляет тексты сцен сценария с `AlignedScene` кадрового маршрута
 * СТРОГО ПОЗИЦИОННО, а не по `order` (фикс-раунд 1, Critical 2, ревью).
 *
 * `AlignedScene.order` может дублироваться — задокументированная реальность
 * проекта (`transcription/align.ts`: «order может дублироваться — известная
 * реальность проекта»), и карта «текст по order» положила бы текст одной
 * сцены на речь другой: обе одноимённые сцены получили бы из карты один и
 * тот же (последний записанный) текст.
 *
 * Решение — тот же приём, каким это уже закрыто на старом маршруте
 * (дуп-order-бриф, `alignedScenesMatchPlanPositions` в `runAssembly`):
 *  1. Позиционное тождество `alignedScenes[i] ↔ planScenes[i]` ПОДТВЕРЖДЕНО
 *     (длины совпадают, `order` совпадает поэлементно) — сопоставляем по
 *     ПОЗИЦИИ. Дубль `order` не мешает: индекс уже однозначен.
 *  2. Тождество НЕ подтверждено, но `order` среди `alignedScenes` НЕ
 *     повторяется И среди `planScenes` тоже не повторяется — сопоставление
 *     по `order` безопасно (неоднозначности нет по построению ни с одной
 *     стороны), берём его.
 *  3. Тождество не подтверждено И `order` повторяется — либо среди
 *     `alignedScenes`, либо среди `planScenes` (фикс-раунд 2, Н-2, ре-ревью:
 *     дубль ТОЛЬКО в `planScenes` при уникальных `alignedScenes` раньше
 *     решался `Map`-построением «последний победил» и молча подставлял
 *     текст чужой сцены — симптом тот же, что у исходного Critical 2, просто
 *     источник дубля другой). Сопоставить текст с ПРАВИЛЬНОЙ сценой нечем ни
 *     одним из способов. Показ субтитра на чужой речи хуже отказа (§10):
 *     бросаем явно, тем же приёмом, что ворота старого маршрута на дубле
 *     `order` (`planAlignedClipTargets`: «две сцены выравнивания указывают
 *     на один и тот же клип»).
 */
export function buildScenesByPositionForShotTimeline(
  alignedScenes: readonly AlignedScene[],
  planScenes: readonly ShotTimelineTextScene[],
): ReadonlyArray<{ text: string, placement?: SubtitlePlacement } | undefined> {
  if (alignedScenesMatchPlanPositions(alignedScenes, planScenes)) {
    return alignedScenes.map((_, i) => shotTimelineTextOf(planScenes[i]))
  }

  const alignedOrderCounts = new Map<number, number>()
  for (const scene of alignedScenes) alignedOrderCounts.set(scene.order, (alignedOrderCounts.get(scene.order) ?? 0) + 1)
  const hasDuplicateAlignedOrder = [...alignedOrderCounts.values()].some(count => count > 1)
  if (hasDuplicateAlignedOrder) {
    throw new Error(
      "Кадровые субтитры: у сцен выравнивания повторяется order, а позиционное тождество с планом "
      + "монтажа не подтверждено — сопоставить текст с правильной сценой нельзя. Показ субтитра на "
      + "чужой речи хуже отказа: сборка остановлена, готовым ролик не помечается (§10).",
    )
  }

  // Н-2 (ре-ревью фикс-раунда 1): order уникален СРЕДИ alignedScenes, но
  // `planScenes` мог дублировать его САМ ПО СЕБЕ (Claude иногда присылает
  // повторяющиеся order — та же реальность, что в `buildSceneClipIndexMap`).
  // Построение `Map` «последний победил» тихо подставило бы текст ЧУЖОЙ
  // одноимённой сцены плана — молчаливая подмена того же класса, что и
  // исходный Critical 2, просто с другой стороны сопоставления.
  const planOrderCounts = new Map<number, number>()
  for (const scene of planScenes) planOrderCounts.set(scene.order, (planOrderCounts.get(scene.order) ?? 0) + 1)
  const neededAmbiguousPlanOrders = [...new Set(alignedScenes.map(s => s.order))]
    .filter(order => (planOrderCounts.get(order) ?? 0) > 1)
  if (neededAmbiguousPlanOrders.length > 0) {
    throw new Error(
      "Кадровые субтитры: у сцен плана монтажа повторяется order "
      + `(${neededAmbiguousPlanOrders.join(", ")}), а позиционное тождество с выравниванием не `
      + "подтверждено — сопоставить текст с правильной сценой нельзя. Показ субтитра на чужой речи "
      + "хуже отказа: сборка остановлена, готовым ролик не помечается (§10).",
    )
  }

  const byOrder = new Map(planScenes.map(s => [s.order, s] as const))
  return alignedScenes.map(scene => shotTimelineTextOf(byOrder.get(scene.order)))
}

export async function runAssembly(
  videoId: number,
  clipPaths: string[],
  musicPath: string | null,
  subtitlesEnabled: boolean,
  hookText: string,
  ctaText: string,
  format: string,
  videoPlan?: StoryDrivenVideoPlan | null,
  extras?: {
    voiceoverPath?: string | null
    musicVolume?: number
    musicVolumeWithVoiceover?: number
    clipVolumeWithVoiceover?: number
    subtitlePreset?: import('./render').SubtitlePresetId
    /** Override subtitleStyle. Если задан — используется ВМЕСТО videoPlan.subtitleStyle.
     * Это финальная точка истины для assembly (читается из Video.subtitlesStyle на уровне выше). */
    subtitleStyleOverride?: SubtitleStyleProfile | null
    /**
     * order'ы сцен в порядке нарезки клипов (prompts.scenePrompts.scenes) — по нему
     * субтитр сцены находит СВОЙ клип. Не передан — раскладка по позициям плана
     * (прежнее поведение) плюс предупреждение в лог шага.
     */
    clipSceneOrders?: readonly number[] | null
    /** Отрезки, где звучит закадровый голос — только там глушится звук клипов. */
    voiceoverIntervals?: Array<{ startSec: number, endSec: number }>
    /**
     * Сцены с ФАКТИЧЕСКИМИ границами слов (маршрут «монтаж от звука»).
     *
     * По ним считаются окна субтитров и подгон длины клипов под трек. Их
     * наличие — ОБЯЗАТЕЛЬСТВО: сборка, которой они переданы, доводит ролик до
     * конца только вместе с состоявшимся подгоном, иначе падает честно (см.
     * ниже). Старый маршрут их не передаёт вовсе и этого обязательства не
     * несёт.
     */
    alignedScenes?: readonly AlignedScene[]
    /**
     * Измеренная длительность единого трека (audio-first) — верхняя граница
     * подгона длины последнего клипа (`planAlignedClipTargets` в render.ts).
     * Без неё подгон по выравниванию не считается вовсе: закрывать сдвиг
     * НЕЧЕМ, если неизвестно, до какой секунды тянуть последний кадр.
     */
    voiceoverDurationSec?: number
    /**
     * Кадровый монтаж (Task 5/6 плана «Сборка по кадрам») спланирован для
     * этого ролика — у него есть строки `VideoShot`. Явный флаг, а НЕ
     * самостоятельный запрос `runAssembly` к БД: функцию напрямую дёргают
     * несколько чистых DB-free тестов (`tests/unit/fixes/assembly-*.spec.ts`
     * и другие), которые мокают только `video-pipeline-db.ts` и глобалы
     * рендера, но не `prisma` — необусловленный поход в БД внутри `runAssembly`
     * уводил бы их в реальное сетевое соединение и валил бы чистую сьюту.
     * Значение проставляет вызывающий (`video-pipeline.ts`, Task 6) по факту
     * состоявшегося `runVideoEditPlan`/`saveShots`; не передан — блок ниже не
     * исполняется вовсе, старый маршрут не задет ни на бит.
     */
    shotRouteActive?: boolean
  },
): Promise<{ filePath: string; duration: number }> {
  const step = await ensureStep(videoId, "assembly", 5)

  if (extras?.alignedScenes?.length) {
    await appendStepLog(
      step.id,
      `Сборка получила выравнивание по звуку: ${extras.alignedScenes.length} сцен с фактическими границами слов`,
    )
  }

  const isStoryDriven = videoPlan && videoPlan.mode !== 'legacy_simple'

  // Список приходит адресованным ПОЗИЦИЕЙ СЦЕНЫ: у сцены, которой в ролике не
  // будет, ячейка пуста. Уплотняем здесь и только здесь — дальше индексы снова
  // означают позицию в склейке, и субтитры обязаны переехать вместе с ними.
  // Пустая строка в concat-листе уронила бы ffmpeg без внятного следа в шаге.
  const compacted = compactSceneClipPaths(clipPaths)
  const assemblyClips = compacted.clips

  let sceneSubtitles: SceneSubtitleInput[] | undefined
  // subtitleStyle: приоритет override (Video.subtitlesStyle) > videoPlan (storyPlan).
  // Это позволяет editor'у править Video.subtitlesStyle и видеть изменения в render
  // после rerunVideoStep('assembly') без модификации storyPlan.
  let subtitleStyle: SubtitleStyleProfile | null = extras?.subtitleStyleOverride ?? null
  let clipOrderWarning: string | null = null

  if (isStoryDriven) {
    if (!subtitleStyle) subtitleStyle = videoPlan.subtitleStyle ?? null
    // sceneIndex субтитра — это индекс его КЛИПА, а клипы нарезаны в порядке
    // prompts.scenePrompts.scenes (порядок задаёт модель, нигде не сортируется).
    // Позиция сцены в videoPlan.scenes этому порядку не равна: при ответе модели
    // [1,2,4,3] субтитр сцены 3 лёг бы на клип сцены 4. Позиционная раскладка
    // остаётся только фолбэком, когда порядок нарезки неизвестен.
    //
    // Считается ВСЕГДА, даже на кадровом маршруте (`extras.shotRouteActive`):
    // это чистое вычисление без похода в сеть, и оно остаётся ЗАПАСНЫМ путём
    // на случай, если `composeVideoShots` не соберёт кадровый таймлайн (флаг
    // выставлен, а `VideoShot` в БД не оказалось — защитный, а не боевой
    // случай). Реальный кадровый маршрут игнорирует эти переменные: финальный
    // вызов `assembleVideo` ниже отдаёт им ход только когда `shotTimeline`
    // не построен (см. докстринг у `shotTimeline`).
    const clipIndexByOrder = buildSceneClipIndexMap(videoPlan.scenes, extras?.clipSceneOrders, {
      allowPositionalFallback: false,
    })
    const clipOrderKnown = clipIndexByOrder.size > 0
    if (!clipOrderKnown) {
      clipOrderWarning = "Порядок нарезки клипов не передан — субтитры разложены по позициям сцен в плане; при перестановке сцен моделью они могут уехать на соседний клип"
    }
    // sceneIndex фиксируем ДО фильтрации: сцена с пустым текстом не должна
    // сдвигать хвост субтитров на сцену вперёд (раньше render раскладывал их
    // строго по позиции в отфильтрованном массиве).
    //
    // Текст субтитра обязан повторять то, что звучит, слово в слово. subtitleCopy —
    // это пересказ сценариста («0% жира — на 35% больше сахара»), тогда как в
    // кадре произносится совсем другая фраза. Берём произносимое: реплику ведущей
    // в кадре или закадровую строку, а пересказ оставляем на случай немой сцены.
    sceneSubtitles = videoPlan.scenes
      .map((s, idx) => {
        const sceneIndex = clipOrderKnown ? clipIndexByOrder.get(s.order) : idx
        return {
          // Индекс сцены переводим в позицию склейки: сцена без клипа из ролика
          // выпала, и все, кто идёт за ней, сдвинулись на её место.
          // Сцена, для которой клипа нет вовсе, отсеивается ниже: класть её субтитр
          // на чужой клип хуже, чем не показать его.
          sceneIndex: sceneIndex === undefined ? undefined : compacted.positionBySceneIndex.get(sceneIndex),
          text: (s.spokenLine?.trim() || s.voiceoverLine?.trim() || s.subtitleCopy || '').trim(),
          placement: s.subtitlePlacement,
          durationSec: s.durationSec,
        }
      })
      .filter((s): s is SceneSubtitleInput => s.sceneIndex !== undefined && s.text.length > 0)
  }

  // Данные для подгона длины клипов под трек — только на маршруте «монтаж от
  // звука» (extras.alignedScenes появляется исключительно там, см. Task 9).
  // Сам подгон (бакеты, пропорции, отказ при нарушении порядка/неизмеримом
  // клипе) считает render.ts — здесь только карта «order сцены → позиция
  // клипа в СКЛЕЙКЕ», её и передаём. На старом маршруте extras.alignedScenes
  // нет вовсе, clipTrackAlignment остаётся undefined, и render.ts подгон не
  // исполняет — поведение прежнее.
  //
  // На КАДРОВОМ маршруте (`extras.shotRouteActive`) это пространство индексов
  // (позиция клипа в склейке) тоже не существует, а подгонять нечего вовсе:
  // кадры по построению уже покрывают трек ровно (Task 6, §8). Блок ниже
  // ЦЕЛИКОМ пропускается — не только его результат не уходит в assembleVideo,
  // но и сам подсчёт не запускается: `clipTrackAlignment` и `shotTimeline`
  // заданные ОДНОВРЕМЕННО — ошибка вызывающего (`planShotAssembly` бросит
  // явно), а платный keyword pre-pass и преflight-проверки ниже по этому же
  // "клиповому" пути на кадровом маршруте просто не нужны.
  let clipTrackAlignment: {
    alignedScenes: readonly AlignedScene[]
    positionByOrder: ReadonlyMap<number, number>
    trackDurationSec: number
  } | undefined
  /** Порядок нарезки неизвестен, позиции взяты из плана — сказать это вслух в логе шага. */
  let fitPositionalOrderWarning: string | null = null
  if (!extras?.shotRouteActive && isStoryDriven && extras?.alignedScenes?.length && typeof extras.voiceoverDurationSec === 'number' && extras.voiceoverDurationSec > 0) {
    // Позиционный фолбэк здесь РАЗРЕШЁН, в отличие от lip-sync и субтитров,
    // которым он отдал бы реплику на чужой клип при перестановке сцен моделью.
    // Порядок нарезки неизвестен ровно в одном случае: ролик снят целиком
    // ведущей, шаг промптов пропущен и scenePrompts нет вовсе
    // (`video-pipeline.ts:621`, `skipPromptGenerationStep`). Тогда позиция сцены
    // в плане — не догадка, а единственный возможный порядок: чужих клипов, на
    // которые могло бы уехать сопоставление, не существует, клип каждой сцены
    // сделал lip-sync — тот же довод, что у `presenterOnlyVideo`
    // (`lip-sync-runner.ts:247-262`), и та же раскладка, которой двадцатью
    // строками выше идут субтитры. Отказ подгона роняет сборку, поэтому
    // разница между «карта пуста по устройству ролика» и «выравнивание
    // выродилось» стоит ролика: ведущая — флагманский сценарий этого маршрута,
    // и без фолбэка НИ ОДИН такой ролик не собрался бы вовсе.
    const fitClipOrderKnown = !!extras?.clipSceneOrders?.length
    const positionByOrder = new Map<number, number>()
    // alignedScenesForFit — тот же массив, что и extras.alignedScenes, кроме
    // случая А ниже, где .order каждой записи ЗАМЕНЯЕТСЯ на её позицию в этом
    // массиве. Копия, extras.alignedScenes не мутируется: он же уходит выше по
    // стеку в lip-sync с ДЕЙСТВИТЕЛЬНЫМ order, и трогать его здесь нельзя.
    let alignedScenesForFit: readonly AlignedScene[] = extras.alignedScenes

    if (fitClipOrderKnown) {
      // Случай Б (дуп-order-бриф) — порядок нарезки клипов известен. `order` —
      // ЕДИНСТВЕННЫЙ мост между videoPlan.scenes и extras.clipSceneOrders: это
      // два независимых массива (нарезку клипов задаёт Claude в
      // prompts.scenePrompts.scenes, и её порядок videoPlan.scenes не обязан
      // повторять), и без order сопоставить их нечем. Если план заявляет два
      // сцены с одним order, а клип с тем же order один — какой из двух сцен
      // он принадлежит, не знает никто: это НАСТОЯЩАЯ неоднозначность, и карта
      // ниже её честно наследует (buildSceneClipIndexMap схлопывает дубль в
      // первую запись), а planAlignedClipTargets увидит два анкора на одной
      // позиции и с полным правом откажет. Ветка не изменилась.
      const clipIndexByOrderForFit = buildSceneClipIndexMap(videoPlan.scenes, extras?.clipSceneOrders, {
        allowPositionalFallback: true,
      })
      for (const [order, sceneIndex] of clipIndexByOrderForFit.entries()) {
        const position = compacted.positionBySceneIndex.get(sceneIndex)
        if (position !== undefined) positionByOrder.set(order, position)
      }
    } else {
      fitPositionalOrderWarning = "Порядок нарезки клипов не передан — подгон длины под трек считает позиции по плану сцен. "
        + "Так приходит ролик, целиком снятый ведущей: text-to-video ему не запускали, чужих клипов не существует"
      // Случай А (дуп-order-бриф) — порядок нарезки клипов не передан, ролик
      // целиком снят ведущей: чужих клипов не существует, и сопоставление
      // сцены с клипом однозначно даже без order — по её ПОЗИЦИИ в плане.
      // Дубль order здесь — ЛОЖНАЯ неоднозначность, но только пока
      // extras.alignedScenes ПОЗИЦИОННО совпадает с videoPlan.scenes. Это НЕ
      // гарантия по устройству ролика — она ломается внутри самого
      // presenterOnly двумя задокументированными путями (ревью фикс-раунда 1):
      //  - сцена, чей spokenLine целиком — маркер паузы («[пауза 2с]») или
      //    пунктуация: presenterOnly её видит непустой (`video-pipeline.ts`:
      //    `spokenLine.trim().length > 0`), а `buildTrackRequest`
      //    (`voiceover/track-builder.ts:63-64`, `if (!cleaned) continue`) —
      //    ЧИСТОЙ и выбрасывает из трека: alignedScenes короче videoPlan.scenes;
      //  - `mergeScriptLines` (`voiceover/script-merge.ts:55`) сортирует
      //    сцены ПО order — если order сцен плана не строго возрастает
      //    (перестановка, не только дубль), alignedScenes идёт в ДРУГОМ
      //    порядке, чем videoPlan.scenes.
      // В обоих случаях синтетический order=sceneIndex отдал бы сцене чужую
      // позицию в склейке МОЛЧА (ok:true, но неверно) — именно та цена
      // ошибки, которой посвящён весь бриф. Поэтому применяем трюк ТОЛЬКО
      // когда сам инвариант подтверждён на этом конкретном входе: длины
      // совпадают и order совпадает поэлементно. Не подтверждён — откат на
      // прежнюю (добро-фиксовую) карту `buildSceneClipIndexMap`: она либо
      // сопоставит верно (нет дублей/перестановок), либо честно откажет
      // (дубль/перестановка) — тот же исход, что был до всей этой задачи.
      //
      // Проверка общая с lip-sync-runner.ts (тот же дубль-order-бриф, выбор
      // куска трека вместо якоря подгона) — вынесена в
      // `presenter/scene-clip-mapping.ts`, чтобы решение «когда позиции
      // доверять» не разъезжалось по двум переписанным копиям.
      const alignedScenesPositional = alignedScenesMatchPlanPositions(extras.alignedScenes, videoPlan.scenes)

      if (alignedScenesPositional) {
        // planAlignedClipTargets и alignedScenesByClipPosition по-прежнему
        // читают только `scene.order` — второй формы карты не появляется,
        // потребителю нечего угадывать.
        alignedScenesForFit = extras.alignedScenes.map((scene, sceneIndex) => ({ ...scene, order: sceneIndex }))
        for (let sceneIndex = 0; sceneIndex < extras.alignedScenes.length; sceneIndex += 1) {
          const position = compacted.positionBySceneIndex.get(sceneIndex)
          if (position !== undefined) positionByOrder.set(sceneIndex, position)
        }
      } else {
        const clipIndexByOrderForFit = buildSceneClipIndexMap(videoPlan.scenes, extras?.clipSceneOrders, {
          allowPositionalFallback: true,
        })
        for (const [order, sceneIndex] of clipIndexByOrderForFit.entries()) {
          const position = compacted.positionBySceneIndex.get(sceneIndex)
          if (position !== undefined) positionByOrder.set(order, position)
        }
      }
    }

    // Карта позиций всё ещё может оказаться пустой (сцены выравнивания не
    // сошлись ни с одной ячейкой склейки) — передаём всё равно: render.ts
    // обязан честно отказаться от подгона и назвать причину (RULING 3, ревью
    // Task 10), а не получить undefined и промолчать, что подгон не пытался
    // исполниться вовсе.
    clipTrackAlignment = {
      alignedScenes: alignedScenesForFit,
      positionByOrder,
      trackDurationSec: extras.voiceoverDurationSec,
    }
  }

  const hasSceneSubs = subtitlesEnabled && sceneSubtitles && sceneSubtitles.length > 0

  // Story-driven ролик с включёнными субтитрами, у которого после сборки не осталось
  // ни одного per-scene субтитра. Так бывает штатно: оператор вычистил subtitleCopy
  // через POST /api/videos/[id]/edit-subtitles (эндпоинт принимает пустую строку),
  // либо ни одна сцена не сопоставилась со своим клипом и все субтитры отсеялись выше.
  // Раньше такой ролик молча уезжал в рендер вообще без надписей, хотя оператор видел
  // subtitlesEnabled=true — сигнала об этом не было нигде.
  //
  // Откатываемся на legacy hook/CTA: это единственный текст, который у нас гарантированно
  // есть, и немой ролик при включённых субтитрах удивит оператора сильнее, чем знакомые
  // хук и призыв на экране. Дублирования с per-scene субтитрами тут быть не может —
  // ветка работает ровно тогда, когда их ноль. В обоих случаях (откатились или откатываться
  // не на что) пишем WARN в лог шага, чтобы источник надписей был виден без гадания.
  //
  // На кадровом маршруте (`extras.shotRouteActive`, `shotTimeline` реально
  // построен) ни `storySubsMissing`, ни `legacyTexts` не идут в
  // `assembleVideo` НАПРЯМУЮ — финальный вызов ниже отдаёт им ход только
  // когда `shotTimeline` не построен (запасной путь, см. докстринг там же).
  // Здесь эти переменные по-прежнему считаются от `hasSceneSubs` (клиповая
  // раскладка) — это тот же самый запасной путь, а не боевой вывод.
  const storySubsMissing = subtitlesEnabled && !!isStoryDriven && !hasSceneSubs
  const hasLegacyTexts = (hookText ?? '').trim().length > 0 || (ctaText ?? '').trim().length > 0
  const legacyFallbackUsed = storySubsMissing && hasLegacyTexts
  // Legacy hook/CTA рендерим в legacy_simple всегда, а в story-driven — только как
  // аварийный фолбэк выше.
  const legacyTexts = subtitlesEnabled && (!isStoryDriven || legacyFallbackUsed)

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: step.attemptCount + 1,
    inputSnapshot: {
      clipPaths: assemblyClips,
      musicPath,
      subtitlesEnabled,
      format,
      hasSceneSubtitles: hasSceneSubs,
      hasSubtitleStyle: !!subtitleStyle,
      runtimeMode: videoPlan?.mode ?? 'legacy_simple',
      // Видно в снапшоте шага, почему на ролике оказались (или не оказались) надписи.
      subtitleFallback: legacyFallbackUsed
        ? 'legacy_texts'
        : storySubsMissing ? 'none_available' : null,
    },
  })
  const hasVoiceover = !!extras?.voiceoverPath
  await appendStepLog(step.id, `Собираю видео: ${assemblyClips.length} клипов, музыка: ${musicPath ? "да" : "нет"}, voiceover: ${hasVoiceover ? "да" : "нет"}, субтитры: ${subtitlesEnabled}${hasSceneSubs ? ` (${sceneSubtitles!.length} per-scene subs)` : ""}${subtitleStyle ? " (styled)" : ""}`)
  if (compacted.missingSceneIndexes.length > 0) {
    // Сцена без клипа — это дыра в сценарии, а не деталь реализации: её надо
    // видеть в шаге, иначе «ролик короче ожидаемого» останется без объяснения.
    await appendStepLog(
      step.id,
      `Сцены без клипа (позиции ${compacted.missingSceneIndexes.join(", ")}) в ролик не попадут — `
      + `собираю ${assemblyClips.length} из ${clipPaths.length} сцен`,
    )
  }
  if (clipOrderWarning && hasSceneSubs) await appendStepLog(step.id, clipOrderWarning)
  if (fitPositionalOrderWarning) await appendStepLog(step.id, fitPositionalOrderWarning)
  if (legacyFallbackUsed) {
    await appendStepLog(step.id, "WARN: субтитры включены, но ни у одной сцены нет текста — накладываю legacy hook/CTA. Проверьте тексты сцен в редакторе субтитров.")
  } else if (storySubsMissing) {
    await appendStepLog(step.id, "WARN: субтитры включены, но текста нет ни у сцен, ни в hook/CTA — ролик соберётся без надписей")
  }
  await updateVideoStatus(videoId, "assembling", { currentStep: "assembly" })

  let keywordHints: Array<{ order: number; keywords: Array<{ word: string; weight: number }> }> | undefined
  /** Кадровый таймлайн (Task 6) — заполняется только в кадровой ветке ниже. */
  let shotTimeline: AssembleOptions["shotTimeline"]

  try {
    // ── Ворота маршрута «монтаж от звука»: подгон длины решается ДО денег ─────
    //
    // Сборка, получившая выравнивание по звуку, обязана предъявить состоявшийся
    // подгон длины клипов под трек: на этом маршруте звук — эталон времени, и
    // картинка подгоняется под него (spec §8). Обе проверки стоят ВЫШЕ платного
    // предпрохода детектора ключевых слов и выше рендера намеренно: отказ
    // детерминирован (то же выравнивание — тот же отказ), и на обречённом ролике
    // предпроход оплачивался бы заново при каждом перезапуске, а его кэш живёт
    // только в памяти процесса.
    //
    // Данных для подгона не собралось вовсе — считать нечего, ролик уехал бы в
    // хранилище длиннее собственной озвучки со статусом «готов». На кадровом
    // маршруте (`extras.shotRouteActive`) `alignedScenes` заданы, а
    // `clipTrackAlignment` НАМЕРЕННО не строится (см. блок выше) — это не
    // отказ, а нормальное устройство маршрута, поэтому ворота его не задевают.
    if (!extras?.shotRouteActive && extras?.alignedScenes?.length && !clipTrackAlignment) {
      throw new Error(
        "Подгон длины клипов под звуковой трек невозможен: "
        + (isStoryDriven ? "измеренная длина единого трека не доехала до сборки" : "ролик собран не по сценарному плану")
        + ". На маршруте «монтаж от звука» картинка обязана подгоняться под звук — сборка остановлена, готовым ролик не помечается",
      )
    }

    // Дешёвая проверка того же плана подгона, что посчитает render.ts.
    //
    // Мерим ТЕМ ЖЕ строгим `probeMediaDuration`, что и решающий `fitClipsToTrack`
    // (render.ts), а не `probeSceneClipDurations`: тот неизмеримому файлу
    // подставляет `FALLBACK_CLIP_DURATION_SEC`, и ворота с ним НИКОГДА не
    // отказывали по причине «клип не измерен» — единственный отказ, зависящий от
    // длительностей, уезжал ниже, под платный предпроход детектора ключевых слов,
    // и на обречённом ролике предпроход оплачивался бы заново на каждом
    // перезапуске. С одинаковым замером ворота — честное надмножество решения:
    // все причины отказа `planAlignedClipTargets` (нулевой интервал трека,
    // порядок сцен, две сцены на один клип, пустая карта позиций, неизмеримый
    // клип) видны уже здесь.
    //
    // Замер здесь идёт по ИСХОДНЫМ клипам, а решающий подгон — по нормализованным
    // (они короче на сотые доли кадра). Разница влияет только на ВЕСА пропорции
    // внутри бакета, то есть на сами заказанные длины, но не на вердикт ok/не ok;
    // а неизмеримый клип нормализацией не «выздоравливает» — `normalizeClip`
    // на битом файле падает сам. Итоговое слово всё равно остаётся за render.ts.
    if (clipTrackAlignment) {
      const preflightDurations = await Promise.all(assemblyClips.map(clip => probeMediaDuration(clip)))
      const preflight = planAlignedClipTargets({
        alignedScenes: clipTrackAlignment.alignedScenes,
        trackDurationSec: clipTrackAlignment.trackDurationSec,
        positionByOrder: clipTrackAlignment.positionByOrder,
        actualDurationsSec: preflightDurations,
        clipCount: assemblyClips.length,
      })
      if (!preflight.ok) {
        await appendStepLog(step.id, `Подгон длины клипов под трек невозможен: ${preflight.reason ?? 'причина не сообщена'}`)
        throw new Error(
          `Подгон длины клипов под звуковой трек не состоится (${preflight.reason ?? 'причина не сообщена'}). `
          + "На маршруте «монтаж от звука» картинка обязана подгоняться под звук — иначе ролик выйдет "
          + "длиннее собственной озвучки; сборка остановлена до рендера, готовым ролик не помечается",
        )
      }
    }

    // ── Кадровая композиция и таймлайн (Task 5/6, §6.3/§8) ──────────────────
    //
    // Собирает по одному готовому файлу на каждый VideoShot — фон, ведущий
    // или их PiP (Task 5), затем строит кадровый таймлайн сборки (Task 6):
    // конкат готовых файлов кадров в порядке `order` + субтитры по
    // абсолютному времени трека (`buildTrackSubtitleSegments`). Действует
    // ТОЛЬКО когда вызывающий явно подтвердил кадровый маршрут
    // (`extras.shotRouteActive`) — НЕ по самостоятельному запросу к БД:
    // `runAssembly` вызывают напрямую несколько чистых DB-free тестов, не
    // мокающих `prisma`, и необусловленный `prisma.video.findUnique(...)`
    // увёл бы их в реальное сетевое соединение (см. докстринг поля).
    if (extras?.shotRouteActive) {
      const videoForProfile = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
          editProfileId: true, editOverrides: true, editProfile: true, applicationId: true,
          voiceoverReconciliation: true,
        },
      })

      // §8 требует выключить voiceoverReconciliation ЯВНО, а не полагаться на
      // то, что единственный вызывающий `extendVideoClip` (посценный шаг
      // озвучки) на этом маршруте просто не исполняется (устройство ветки в
      // `video-pipeline.ts`, а не правило, которое переживёт рефакторинг
      // оркестратора). Кадр уже нарезан по речи — мирить нечего, а подмена
      // клипов `*_ext.mp4` (политика `extend_scene`) разошлась бы с уже
      // точным таймлайном кадров.
      const reconciliationPolicy = videoForProfile?.voiceoverReconciliation ?? null
      if (reconciliationPolicy) {
        await appendStepLog(
          step.id,
          `Кадровый монтаж: политика voiceoverReconciliation="${reconciliationPolicy}" на этом маршруте не `
          + "применяется — кадр уже нарезан по речи, мирить нечего, а подмена клипов *_ext.mp4 разошлась бы "
          + "с таймлайном кадров",
        )
      }

      const appDefaultEditProfile = videoForProfile && !videoForProfile.editProfile && videoForProfile.applicationId
        ? await prisma.editProfile.findFirst({ where: { appId: videoForProfile.applicationId, isDefault: true } })
        : null
      const resolvedShotProfile = resolveEditProfile(
        (videoForProfile?.editProfile ?? appDefaultEditProfile) as unknown as Partial<ResolvedEditProfile> | null,
        videoForProfile?.editOverrides,
      )
      const composeResult = await composeVideoShots(
        videoId,
        step,
        extras?.alignedScenes ?? [],
        resolvedShotProfile,
        format === "landscape" ? "landscape" : "portrait",
      )

      // composeResult === null — у ролика нет ни одной строки VideoShot,
      // несмотря на выставленный флаг (в проде недостижимо: `shotRouteActive`
      // проставляется ТОЛЬКО по факту состоявшегося `runVideoEditPlan`,
      // video-pipeline.ts). Раньше здесь был «запасной» откат на клиповый
      // путь — Сомнение 2 фикс-раунда 1 (ревью) указало, что откат НЕ
      // безопаснее старого маршрута, а опаснее: `clipTrackAlignment` и
      // преflight-ворота подгона длины остаются выключены гейтом
      // `!extras?.shotRouteActive` (они гасятся ПО ФЛАГУ, а не по факту
      // `composeResult`), и ролик с `alignedScenes` (audio-first!) собрался
      // бы из клипов БЕЗ подгона длины под трек и получил статус «готов» —
      // ровно то, ради предотвращения чего эти ворота писались. Честный
      // отказ дешевле тихого неверного ролика (§10).
      if (!composeResult) {
        throw new Error(
          `Кадровый монтаж ролика ${videoId}: маршрут подтверждён (shotRouteActive), но у ролика нет `
          + "ни одной строки VideoShot — собирать нечего. Сборка остановлена, готовым ролик не помечается (§10)",
        )
      }
      {
        // Верхняя граница таймлайна — измеренная длина трека
        // (`extras.voiceoverDurationSec`), БЕЗ фолбэка на конец последнего
        // кадра (фикс-раунд 2, Н-5, ре-ревью): фолбэк молча брал число ИЗ
        // ТЕХ ЖЕ `shots`, которые `assertShotsCoverTrack` обязана против него
        // же и сверить — проверка хвоста таймлайна вырождалась в тавтологию
        // (`trackDurationSec === последний.endSec` по построению, PASS
        // всегда). На кадровом маршруте трек обязан быть измерен — тот же
        // факт, из которого проставляется сам `shotRouteActive`
        // (`video-pipeline.ts`), — и отсутствие числа честнее считать браком
        // входа, чем достраивать его из данных, которые оно же должно
        // проверять.
        if (typeof extras?.voiceoverDurationSec !== 'number' || !(extras.voiceoverDurationSec > 0)) {
          throw new Error(
            `Кадровый монтаж ролика ${videoId}: измеренная длина трека не доехала до сборки — без неё `
            + "нечем проверить, что кадры покрывают трек целиком. Сборка остановлена, готовым ролик не "
            + "помечается (§10)",
          )
        }

        // Субтитры кадрового маршрута — от АБСОЛЮТНОГО времени трека
        // (`buildTrackSubtitleSegments`), а не от позиции клипа в склейке:
        // `AlignedScene`/`VideoShot` живут в одном пространстве координат
        // (Task 6, главное упрощение задачи — см. shot-subtitles.ts). Текст
        // сопоставляется с `alignedScenes` СТРОГО ПОЗИЦИОННО, а не по `order`
        // (Critical 2, фикс-раунд 1) — `buildScenesByPositionForShotTimeline`
        // бросит явно, если `order` дублируется (в выравнивании ИЛИ в плане,
        // Н-2 фикс-раунда 2) и позиционное тождество с планом не подтверждено
        // (см. её докстринг). Считается ТОЛЬКО при включённых субтитрах
        // (Н-3, ре-ревью): ролик без субтитров падать из-за дубля order,
        // которому нечего было бы показывать, не должен.
        const shotTrackAlignedScenes = extras?.alignedScenes ?? []
        const presetMetaForChunks = getPresetByKey(extras?.subtitlePreset)
        const subtitleSegments = subtitlesEnabled && isStoryDriven
          ? buildTrackSubtitleSegments({
            alignedScenes: shotTrackAlignedScenes,
            scenesByPosition: buildScenesByPositionForShotTimeline(shotTrackAlignedScenes, videoPlan.scenes),
            maxChars: maxCharsForWidth(
              format === 'portrait' ? 1080 : 1920,
              format === 'portrait' ? presetMetaForChunks.fontSizePortrait : presetMetaForChunks.fontSizeLandscape,
              format === 'portrait' ? 60 : 100,
            ),
          })
          : []

        shotTimeline = {
          shots: composeResult.shots,
          trackDurationSec: extras.voiceoverDurationSec,
          subtitleSegments: subtitleSegments.length > 0 ? subtitleSegments : undefined,
        }
        await appendStepLog(
          step.id,
          `Кадровый монтаж: таймлайн собран из ${composeResult.shots.length} кадров, субтитров: ${subtitleSegments.length}`,
        )
      }
    }

    // Keyword pre-pass — только для пресетов с needsKeywordDetection=true. При выключенных
    // paid-apis или ошибке агента — graceful degrade (фолбэк на эвристику внутри ass-builder).
    // `!shotTimeline` — на кадровом маршруте, когда таймлайн реально построен,
    // `keywordHints` некуда положить (`buildTrackSubtitleSegments` их не
    // принимает вовсе, финальный вызов ниже отдаёт `sceneSubtitles` только
    // запасному пути) — платить за AI-анализ, чей результат выбросят, незачем.
    if (subtitlesEnabled && hasSceneSubs && extras?.subtitlePreset && !shotTimeline) {
      const presetMeta = getPresetByKey(extras.subtitlePreset)
      if (presetMeta.needsKeywordDetection) {
        try {
          // order = sceneIndex + 1 — тот же ключ, по которому render читает подсказки
          // (aiMap.get(sceneIndex + 1)). Нумерация с единицы: так её видит AI-агент.
          const segs = sceneSubtitles!.map(s => ({ order: s.sceneIndex + 1, text: s.text }))
          const lang = videoPlan?.subtitleStyle?.typography?.fontIntent?.toLowerCase().includes('rus')
            ? 'ru'
            : 'en'
          const result = await runSubtitleKeywordAgent({
            segments: segs,
            language: lang,
            maxKeywordsPerSegment: 2,
          })
          keywordHints = result.segments
          await appendStepLog(step.id, `AI keyword-detector: помечено ${result.segments.reduce((acc, s) => acc + s.keywords.length, 0)} слов в ${result.segments.length} сегментах`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          await appendStepLog(step.id, `AI keyword-detector недоступен (${msg.slice(0, 120)}), используется эвристика`)
        }
      }
    }

    const outputPath = join(getVideosDir(), `${videoId}.mp4`)
    await safeUnlink(outputPath)
    // Legacy hook/cta — для legacy_simple и для story-driven без единого субтитра
    // (см. legacyTexts выше). В обычном story-driven за текст на экране отвечают
    // per-scene субтитры; hookText/ctaText там дублировали бы их поверх всего ролика
    // (и всплывали в ASS-ветке, где legacy-сегменты идут на всю длину).
    //
    // `shotTimeline` реально построен (кадровый маршрут состоялся) — клиповые
    // sceneSubtitles/legacy-тексты ему не передаются вовсе: субтитры несёт
    // сам `shotTimeline.subtitleSegments`, а topText/bottomText на этом
    // маршруте — чужое понятие (Task 6, §5). `hasSceneSubs`/`legacyTexts`
    // остаются ЗАПАСНЫМ путём — только когда `extras.shotRouteActive` был
    // выставлен, а сам таймлайн не собрался (защитный, не боевой случай, см.
    // докстринг поля `shotRouteActive`).
    const result = await assembleVideo({
      clips: assemblyClips,
      topText: shotTimeline ? "" : (legacyTexts ? hookText : ""),
      bottomText: shotTimeline ? "" : (legacyTexts ? ctaText : ""),
      musicPath,
      format: format as "portrait" | "landscape",
      outputPath,
      sceneSubtitles: shotTimeline ? undefined : (hasSceneSubs ? sceneSubtitles : undefined),
      subtitleStyle: subtitlesEnabled ? subtitleStyle : undefined,
      subtitlePreset: extras?.subtitlePreset,
      keywordHints,
      voiceoverPath: extras?.voiceoverPath ?? null,
      musicVolume: extras?.musicVolume,
      musicVolumeWithVoiceover: extras?.musicVolumeWithVoiceover,
      clipVolumeWithVoiceover: extras?.clipVolumeWithVoiceover,
      voiceoverIntervals: extras?.voiceoverIntervals,
      clipTrackAlignment,
      shotTimeline,
    })

    // RULING 3 (ревью Task 10): подгон длины клипов под трек обязан быть
    // виден в логе шага — применён (сколько клипов подрезано/удержано и на
    // сколько суммарно) либо не применён и почему. Раньше о нём не писалось
    // ничего, и оба случая тихого отключения (нет clipSceneOrders, клип не
    // измерен) были неотличимы от «подгон и не должен был исполняться».
    if (clipTrackAlignment) {
      const fit = result.durationFit
      if (!fit || !fit.applied) {
        const reason = fit?.reason ?? 'причина не сообщена'
        await appendStepLog(step.id, `Подгон длины клипов под трек НЕ применён: ${reason}`)
        // Отказ подгона на этом маршруте — брак, а не деградация. Подгон
        // выключается ЦЕЛИКОМ для ролика (см. `planAlignedClipTargets`), значит
        // каждый клип остался своей длины, а звук трогать нельзя никогда (spec
        // §8) — картинка расходится со звуком на всём ролике. Раньше
        // единственным следом этого была строка выше: ролик заливался в
        // хранилище и получал статус «готов». Тот же класс брака, ради которого
        // принят ruling «транскрипция обязательна» (spec §4.1), и та же реакция,
        // что у §10 на упавшую после синтеза трека транскрипцию: «шаг падает
        // честно, ролик не помечается готовым».
        //
        // Деньги отказ не ТЕРЯЕТ: все платные шаги (трек, транскрипция,
        // картинки, клипы, lip-sync) уже лежат в своих снапшотах, повторный
        // прогон их не оплачивает, а сама сборка бесплатна — локальный ffmpeg.
        //
        // Но и бесплатного выхода отсюда нет — не обещай его читателю. Простой
        // перезапуск воспроизведёт ТОТ ЖЕ отказ: причина детерминирована, а
        // транскрипт кэшируется по отпечатку трека (`runVideoTranscription`
        // выше), и выравнивание придёт ровно то же самое. «Починить
        // выравнивание» означает перегнать транскрипцию (`rerunVideoStep`
        // 'transcription' — платный вызов заново) или пересобрать трек, а новый
        // трек обесценивает и куски, и уже снятые аватарные кадры. Выключить
        // маршрут ролику с готовым треком тоже нельзя даром: `resolveVideoRoute`
        // отвечает 409 «пересоберите ролик с нуля».
        //
        // ЧАСТИЧНОЕ схождение выравнивания (§10: «границы сцены делятся
        // пропорционально, WARN в лог шага») сюда НЕ попадает: там план
        // считается, подгон применяется и возвращает applied:true.
        throw new Error(
          `Подгон длины клипов под звуковой трек не состоялся (${reason}). `
          + "На маршруте «монтаж от звука» картинка обязана подгоняться под звук — иначе ролик выйдет "
          + "длиннее собственной озвучки; сборка остановлена, готовым ролик не помечается",
        )
      } else {
        await appendStepLog(
          step.id,
          `Подгон длины клипов под трек: подрезано ${fit.trimmedCount}, удержан последний кадр у ${fit.heldCount}, `
          + `суммарная правка ${fit.totalDeltaSec.toFixed(2)}с`,
        )
      }
    }

    // Анимационная инфографика (PROJECT_CONTEXT §5) — необязательный слой
    // поверх готового ролика. Он не имеет права уронить сборку: ролик уже
    // собран и годен к публикации, а Remotion тянет headless Chrome и может
    // быть не установлен вовсе.
    //
    // На кадровом маршруте (`shotTimeline` задан) пропускается целиком: план
    // плашек строится по ПОЗИЦИИ КЛИПА В СКЛЕЙКЕ (`compacted.positionBySceneIndex`,
    // `assemblyClips`) — том самом пространстве индексов, которого на этом
    // маршруте не существует (см. блоки выше). Плашка легла бы на чужую сцену
    // так же, как легли бы старые субтитры — это уже отдельная задача плана,
    // не покрытая брифом Task 6.
    if (!shotTimeline) {
      // Сцены отдаём В ПОРЯДКЕ СКЛЕЙКИ и с ФАКТИЧЕСКИМИ длительностями: плашка
      // стоит по абсолютному времени от начала ролика, а план у ролика 24 обещал
      // девять сцен по десять секунд при фактических 82.7. Композиция получалась
      // на 90 секунд — семь секунд немого хвоста, а плашки вставали на чужие сцены.
      const assemblyClipDurations = assemblyClips.length > 0
        ? await probeSceneClipDurations(assemblyClips)
        : []
      type PlanScene = NonNullable<StoryDrivenVideoPlan["scenes"]>[number]
      const planSceneBySlot = new Map<number, PlanScene>()
      if (isStoryDriven && videoPlan) {
        const slotByOrder = buildSceneClipIndexMap(videoPlan.scenes, extras?.clipSceneOrders, {
          allowPositionalFallback: false,
        })
        videoPlan.scenes.forEach((scene, idx) => {
          const slot = slotByOrder.size > 0 ? slotByOrder.get(scene.order) : idx
          if (slot === undefined) return
          const position = compacted.positionBySceneIndex.get(slot)
          if (position !== undefined) planSceneBySlot.set(position, scene)
        })
      }
      const overlayPlan = planRemotionOverlays({
        scenes: assemblyClips.map((_, position) => {
          const scene = planSceneBySlot.get(position)
          return {
            order: scene?.order ?? position + 1,
            durationSec: assemblyClipDurations[position] ?? 0,
            spokenLine: scene?.spokenLine ?? null,
            subtitleCopy: scene?.subtitleCopy ?? null,
          }
        }),
      })
      const overlaid = join(getVideosDir(), `${videoId}_overlays.mp4`)
      const overlayOutcome = await renderRemotionOverlays({
        inputPath: result.filePath,
        outputPath: overlaid,
        plan: overlayPlan,
        format: format === "portrait" ? "portrait" : "landscape",
      }).catch((error: unknown) => ({
        status: "skipped" as const,
        reason: error instanceof Error ? error.message : String(error),
      }))

      if (overlayOutcome.status === "rendered") {
        result.filePath = overlayOutcome.outputPath
        await appendStepLog(step.id, `Инфографика наложена: ${overlayPlan.overlays.length} плашек`)
      } else if (overlayPlan.overlays.length > 0) {
        await appendStepLog(step.id, `Инфографика пропущена: ${overlayOutcome.reason}`)
      }
    } else {
      // Сомнение 3 фикс-раунда 1 (ревью): раньше блок пропускался МОЛЧА —
      // оператор видел ролик без плашек и не имел способа узнать почему.
      // Потеря функциональности, которую находят на демо, а не в логе.
      await appendStepLog(
        step.id,
        "Инфографика на кадровом маршруте не строится: план плашек адресуется позицией клипа в "
        + "склейке, которой на этом маршруте не существует (адаптация — отдельная задача)",
      )
    }

    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      outputSnapshot: { filePath: result.filePath, duration: result.duration },
    })
    await appendStepLog(step.id, `Видео собрано: ${result.duration}s`)

    return result
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Неизвестная ошибка"
    await updateStep(step.id, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: msg.slice(0, 1000),
    })
    await appendStepLog(step.id, `Ошибка сборки: ${msg}`)
    throw error
  }
}

// ─── Enrichment context loader ──────────────────────────────────

export async function loadEnrichmentContext(
  scenario: { appId: number | null },
  _variant: { storyPlan?: unknown },
): Promise<{
  accountStyleContext: string | null
  appContext: string | null
  favoritePrompts: LoadedFavoritePrompt[]
  appId: number | null
  socialAccountId: number | null
}> {
  let accountStyleContext: string | null = null
  let appContext: string | null = null
  let favoritePrompts: LoadedFavoritePrompt[] = []
  let socialAccountId: number | null = null

  if (scenario.appId) {
    try {
      const appCtx = await getAppScenarioContext(scenario.appId)
      if (appCtx) {
        appContext = formatAppContextForPrompt(appCtx)
      }
    } catch { /* non-critical */ }

    try {
      const socialAccount = await prisma.socialAccount.findFirst({
        where: { appId: scenario.appId },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      })
      if (socialAccount) {
        socialAccountId = socialAccount.id
        const styleCtx = await getAccountStyleContext(socialAccount.id)
        accountStyleContext = formatAccountStyleForPrompt(styleCtx)
      }
    } catch { /* non-critical */ }

    try {
      favoritePrompts = await loadFavoritePromptsForScenario({
        appId: scenario.appId,
        autoSelect: true,
        limit: 3,
      })
    } catch { /* non-critical */ }
  }

  return {
    accountStyleContext,
    appContext,
    favoritePrompts,
    appId: scenario.appId ?? null,
    socialAccountId,
  }
}
