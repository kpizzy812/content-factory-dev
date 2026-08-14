/**
 * Video Pipeline — Step runners (prompt, image, clip, music, assembly).
 *
 * Extracted from video-pipeline.ts for maintainability.
 * Each function runs one stage of the video generation pipeline.
 */

import { join } from "node:path"
import type { StoryPlan, SubtitleStyleProfile } from "~~/shared/types/story"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SceneImagePrompts } from "./video-helpers"
import { type DeviceType, buildDeviceNegativesForScene } from "~~/shared/utils/video-prompt-helpers"
import {
  type StepKey,
  type PromptGenerationResult,
  ensureStep,
  updateStep,
  appendStepLog,
  isStepCompleted,
  updateVideoStatus,
} from "./video-pipeline-db"
import { getAccountStyleContext, formatAccountStyleForPrompt } from "./account-style-context"
import { getAppScenarioContext, formatAppContextForPrompt } from "./app-context"
import { synthesizeSpeech, buildVoiceoverTrack } from "./tts"
import { adjustAudioTempo, trimAudio, probeClipDurations, extendVideoClip, planClipExtension } from "./render"
import { buildSceneClipTimeline, type SceneSubtitleInput } from "./subtitles/scene-timeline"
import { buildSceneClipIndexMap } from "./presenter/scene-clip-mapping"
import { getPresetByKey } from "./subtitles/preset-registry"
import { runSubtitleKeywordAgent } from "./agents/subtitle-keyword-agent"
import { pickTtsModel, getModel } from "./video-models"
import { logStepCost } from "./balance/cost-ledger"
import { mapStepKeyToService } from "./balance/cost-attribution"
import { accumulateStepCost, stepAttemptForLedger } from "./video-cost-actual"
import {
  loadFavoritePromptsForScenario,
  bumpFavoritePromptsUsage,
  type LoadedFavoritePrompt,
} from "./agents/favorite-prompts-loader"
import { resolveMediaRoute } from "./media-provider/registry"
import { runMediaTask } from "./media-provider/run-media-task"
import { renderStillClip } from "./video-tools/still-clip-runner"
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

/** Итог шага клипов. generatedCount — сколько клипов реально оплачено В ЭТОМ прогоне. */
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
    }
    // Пустой массив — законный результат: ролик целиком снят ведущей, генерировать
    // было нечего. Поэтому проверяем сам факт массива, а не его длину.
    if (Array.isArray(output.clipPaths)) {
      // Шаг уже выполнен — новых оплаченных генераций нет.
      return {
        clipPaths: output.clipPaths,
        generatedCount: 0,
        scenes: (output.perSceneDurations ?? []).map((s, idx) => ({
          key: s.key,
          order: s.order ?? idx,
          durationSec: s.durationSec,
        })),
      }
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
    scenes = prompts.scenePrompts.scenes.map((s, idx) => {
      const planScene = videoPlan.scenes.find(ps => ps.order === s.order)
      const sceneDuration = planScene?.durationSec ?? clipDuration

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
    const clipPaths: string[] = []
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
          clipPaths.push(existingClip.filePath)
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
        clipPaths.push(clipPath)
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

      clipPaths.push(task.localPath)
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
    await appendStepLog(step.id, presenterSceneIndexes?.size
      ? `Клипы готовы: ${clipPaths.length} шт (${generatedSeconds}s), сгенерировано в этом прогоне ${generatedCount}; ${presenterSceneIndexes.size} сцен отданы ведущей`
      : `Все клипы готовы: ${clipPaths.length} шт, сгенерировано в этом прогоне ${generatedCount} (total: ${generatedSeconds}s)`)

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

  // 4. Build scene timeline из реальных clip durations
  const clipDurations = clipPaths.length > 0 ? await probeClipDurations(clipPaths) : []
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

    // Доступная длительность = clip duration минус small safety gap (0.1s)
    const maxAllowedSec = Math.max(0.5, sceneDurationSec - 0.1)

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
      sceneStartSec: slot?.startSec ?? 0,
      voiceoverDurationSec: a.voiceoverDurationSec,
      sceneDurationSec: slot?.clipDurationSec ?? a.sceneDurationSec,
    }
  })

  const totalDurationSec = effectiveClipDurations.reduce((sum, d) => sum + d, 0)
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
  },
): Promise<{ filePath: string; duration: number }> {
  const step = await ensureStep(videoId, "assembly", 5)

  const isStoryDriven = videoPlan && videoPlan.mode !== 'legacy_simple'

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
      .map((s, idx) => ({
        // Сцена, для которой клипа нет вовсе, отсеивается ниже: класть её субтитр
        // на чужой клип хуже, чем не показать его.
        sceneIndex: clipOrderKnown ? clipIndexByOrder.get(s.order) : idx,
        text: (s.spokenLine?.trim() || s.voiceoverLine?.trim() || s.subtitleCopy || '').trim(),
        placement: s.subtitlePlacement,
        durationSec: s.durationSec,
      }))
      .filter((s): s is SceneSubtitleInput => s.sceneIndex !== undefined && s.text.length > 0)
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
      clipPaths,
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
  await appendStepLog(step.id, `Собираю видео: ${clipPaths.length} клипов, музыка: ${musicPath ? "да" : "нет"}, voiceover: ${hasVoiceover ? "да" : "нет"}, субтитры: ${subtitlesEnabled}${hasSceneSubs ? ` (${sceneSubtitles!.length} per-scene subs)` : ""}${subtitleStyle ? " (styled)" : ""}`)
  if (clipOrderWarning && hasSceneSubs) await appendStepLog(step.id, clipOrderWarning)
  if (legacyFallbackUsed) {
    await appendStepLog(step.id, "WARN: субтитры включены, но ни у одной сцены нет текста — накладываю legacy hook/CTA. Проверьте тексты сцен в редакторе субтитров.")
  } else if (storySubsMissing) {
    await appendStepLog(step.id, "WARN: субтитры включены, но текста нет ни у сцен, ни в hook/CTA — ролик соберётся без надписей")
  }
  await updateVideoStatus(videoId, "assembling", { currentStep: "assembly" })

  // Keyword pre-pass — только для пресетов с needsKeywordDetection=true. При выключенных
  // paid-apis или ошибке агента — graceful degrade (фолбэк на эвристику внутри ass-builder).
  let keywordHints: Array<{ order: number; keywords: Array<{ word: string; weight: number }> }> | undefined
  if (subtitlesEnabled && hasSceneSubs && extras?.subtitlePreset) {
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

  try {
    const outputPath = join(getVideosDir(), `${videoId}.mp4`)
    await safeUnlink(outputPath)
    // Legacy hook/cta — для legacy_simple и для story-driven без единого субтитра
    // (см. legacyTexts выше). В обычном story-driven за текст на экране отвечают
    // per-scene субтитры; hookText/ctaText там дублировали бы их поверх всего ролика
    // (и всплывали в ASS-ветке, где legacy-сегменты идут на всю длину).
    const result = await assembleVideo({
      clips: clipPaths,
      topText: legacyTexts ? hookText : "",
      bottomText: legacyTexts ? ctaText : "",
      musicPath,
      format: format as "portrait" | "landscape",
      outputPath,
      sceneSubtitles: hasSceneSubs ? sceneSubtitles : undefined,
      subtitleStyle: subtitlesEnabled ? subtitleStyle : undefined,
      subtitlePreset: extras?.subtitlePreset,
      keywordHints,
      voiceoverPath: extras?.voiceoverPath ?? null,
      musicVolume: extras?.musicVolume,
      musicVolumeWithVoiceover: extras?.musicVolumeWithVoiceover,
      clipVolumeWithVoiceover: extras?.clipVolumeWithVoiceover,
      voiceoverIntervals: extras?.voiceoverIntervals,
    })

    // Анимационная инфографика (PROJECT_CONTEXT §5) — необязательный слой
    // поверх готового ролика. Он не имеет права уронить сборку: ролик уже
    // собран и годен к публикации, а Remotion тянет headless Chrome и может
    // быть не установлен вовсе.
    const overlayPlan = planRemotionOverlays({
      scenes: (videoPlan?.scenes ?? []).map(scene => ({
        order: scene.order,
        durationSec: scene.durationSec,
        spokenLine: scene.spokenLine ?? null,
        subtitleCopy: scene.subtitleCopy ?? null,
      })),
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
