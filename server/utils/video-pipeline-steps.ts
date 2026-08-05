/**
 * Video Pipeline — Step runners (prompt, image, clip, music, assembly).
 *
 * Extracted from video-pipeline.ts for maintainability.
 * Each function runs one stage of the video generation pipeline.
 */

import { join } from "node:path"
import type { StoryPlan, SubtitleStyleProfile, SubtitlePlacement } from "~~/shared/types/story"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SceneImagePrompts } from "./video-helpers"
import { type DeviceType, buildDeviceNegativesForScene } from "~~/shared/utils/video-prompt-helpers"
import {
  type StepKey,
  type FalImageResult,
  type FalVideoResult,
  type PromptGenerationResult,
  ensureStep,
  updateStep,
  appendStepLog,
  isStepCompleted,
  updateVideoStatus,
  falStepRequest,
} from "./video-pipeline-db"
import { getAccountStyleContext, formatAccountStyleForPrompt } from "./account-style-context"
import { getAppScenarioContext, formatAppContextForPrompt } from "./app-context"
import { synthesizeSpeech, buildVoiceoverTrack } from "./tts"
import { adjustAudioTempo, trimAudio, probeClipDurations } from "./render"
import { getPresetByKey } from "./subtitles/preset-registry"
import { runSubtitleKeywordAgent } from "./agents/subtitle-keyword-agent"
import { pickTtsModel, getModel } from "./video-models"
import { logStepCost } from "./balance/cost-ledger"
import { mapStepKeyToService } from "./balance/cost-attribution"
import {
  loadFavoritePromptsForScenario,
  bumpFavoritePromptsUsage,
  type LoadedFavoritePrompt,
} from "./agents/favorite-prompts-loader"
import {
  resolveAppReferenceLocalPath,
  detectAppReferenceMediaType,
} from "./agents/screen-tagger-agent"
import { falUploadFile } from "./fal"
import { StorageKeys } from "./storage/keys"
import { uploadLocalAsset } from "./storage/persist-asset"
import { storageKeyToLegacyUrl } from "./storage/download-to-storage"

/** Endpoint для image-to-video Kling (сцены с привязкой к скриншоту приложения). */
const KLING_IMAGE_TO_VIDEO_ENDPOINT = "fal-ai/kling-video/v2.1/standard/image-to-video"

/** Image-to-video v2.1 standard принимает только duration "5" или "10". */
function clampKlingI2vDuration(durationSec: number): "5" | "10" {
  return durationSec > 7 ? "10" : "5"
}

/**
 * Строит input payload для text-to-video clip generation в зависимости от модели.
 *
 * У каждой модели в fal.ai свой input schema:
 *  - Kling: duration: string, generate_audio: bool, native audio
 *  - Wan: num_frames + frames_per_second, resolution enum, без аудио
 *  - Hailuo: duration: 5|10 (enum), prompt_optimizer, без аудио
 *
 * При расширении реестра новой text-to-video моделью — добавить ветку сюда.
 * Image-to-video (appScreenRef) всегда идёт через KLING_IMAGE_TO_VIDEO_ENDPOINT
 * вне зависимости от выбранной text-to-video модели — Wan T2V не принимает image_url.
 */
function buildClipPayload(
  modelId: string,
  opts: {
    prompt: string
    durationSec: number
    aspectRatio: "9:16" | "16:9" | "1:1"
    negativePrompt: string
    generateAudio: boolean
  },
): Record<string, unknown> {
  if (modelId.startsWith("fal-ai/kling-video/")) {
    return {
      prompt: opts.prompt,
      duration: String(opts.durationSec),
      aspect_ratio: opts.aspectRatio,
      generate_audio: opts.generateAudio,
      negative_prompt: opts.negativePrompt,
    }
  }

  if (modelId.startsWith("fal-ai/wan/")) {
    // Wan: длительность = num_frames / frames_per_second.
    // fps=16 — default, num_frames ∈ [17, 161] → допустимый диапазон 1.06–10.06s.
    const fps = 16
    const numFrames = Math.max(17, Math.min(161, Math.round(opts.durationSec * fps)))
    return {
      prompt: opts.prompt,
      num_frames: numFrames,
      frames_per_second: fps,
      aspect_ratio: opts.aspectRatio,
      negative_prompt: opts.negativePrompt,
      resolution: "720p",
    }
  }

  if (modelId.startsWith("fal-ai/minimax/hailuo")) {
    return {
      prompt: opts.prompt,
      duration: opts.durationSec >= 7 ? 10 : 5,
      prompt_optimizer: true,
    }
  }

  // Fallback на Kling-формат для незнакомой kling-совместимой модели — лучше
  // попробовать, чем падать. Если submit вернёт 422 — log покажет, какая модель.
  console.warn(`[buildClipPayload] неизвестная модель ${modelId}, использую Kling-payload как fallback`)
  return {
    prompt: opts.prompt,
    duration: String(opts.durationSec),
    aspect_ratio: opts.aspectRatio,
    generate_audio: opts.generateAudio,
    negative_prompt: opts.negativePrompt,
  }
}

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

      const legacyPrompts = await generateImagePrompts({
        hook: variant.hook,
        body: variant.body,
        cta: variant.cta,
        visualStyle: variant.visualStyleText,
        storyPlan,
      })

      result = {
        ...legacyPrompts,
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

export async function runImageGeneration(
  videoId: number,
  prompts: PromptGenerationResult,
  format: string,
  imageCount: number = 3,
  imageModelId: string,
  renderQuality: string,
  videoPlan?: StoryDrivenVideoPlan | null,
): Promise<{ imagePaths: string[]; imageRemoteUrls: string[] }> {
  const step = await ensureStep(videoId, "image_generation", 1)

  // Cost-aware: даже в story-driven clip-only режиме генерим МИНИМУМ 1 изображение
  // первой сцены — нужно для preview thumbnail в UI. Раньше тут был полный skip,
  // но user не видел превью видео без главного кадра.
  const thumbnailOnly = videoPlan?.skipImageGeneration === true
  const effectiveImageCount = thumbnailOnly ? 1 : imageCount

  if (isStepCompleted(step) && step.outputSnapshot) {
    const output = step.outputSnapshot as { imagePaths: string[]; imageRemoteUrls?: string[] }
    if (output.imagePaths?.length === effectiveImageCount) {
      return { imagePaths: output.imagePaths, imageRemoteUrls: output.imageRemoteUrls || [] }
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
  await updateVideoStatus(videoId, "generating_images", { currentStep: "image_generation" })

  const assetsDir = getAssetsDir(videoId)
  await ensureDir(assetsDir)

  const scenes: { key: string; prompt: string; order: number; devicesInScene?: DeviceType[] }[] = []

  if (prompts.scenePrompts?.scenes && prompts.scenePrompts.scenes.length > 0) {
    const sp = prompts.scenePrompts.scenes
    // В thumbnail-only режиме берём ТОЛЬКО первую сцену (hook).
    const sceneCount = thumbnailOnly ? 1 : sp.length
    if (!thumbnailOnly && sceneCount !== imageCount) {
      await appendStepLog(step.id, `Story-driven: ${sp.length} сцен (imageCount=${imageCount} расширен до ${sceneCount} чтобы не потерять сцены)`)
    }

    // FLUX не имеет negative_prompt — AVOID-список инжектируем в конец prompt.
    // devicesInScene берём из videoPlan.scenes (там санитизированный массив).
    for (let i = 0; i < sceneCount; i++) {
      const scene = sp[i]!
      const planScene = videoPlan?.scenes.find(ps => ps.order === scene.order)
      const devices = planScene?.devicesInScene && planScene.devicesInScene.length > 0
        ? [...planScene.devicesInScene]
        : undefined
      const avoidList = buildDeviceNegativesForScene({ devices, hasAppScreenRef: false })
      const finalPrompt = avoidList.length > 0
        ? `${scene.prompt}\n\nAVOID: ${avoidList.join(", ")}`
        : scene.prompt
      scenes.push({
        key: `scene_${scene.order}`,
        prompt: finalPrompt,
        order: i,
        devicesInScene: devices,
      })
    }
  } else {
    const cnt = thumbnailOnly ? 1 : imageCount
    for (let i = 0; i < cnt; i++) {
      if (i === 0) {
        scenes.push({ key: "hook", prompt: prompts.hook, order: i })
      } else if (i === cnt - 1) {
        scenes.push({ key: "cta", prompt: prompts.cta, order: i })
      } else {
        scenes.push({ key: `body_${i}`, prompt: prompts.body, order: i })
      }
    }
  }

  try {
    const imagePaths: string[] = []
    const imageRemoteUrls: string[] = []

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

      const isLowQuality = renderQuality === "low"
      const imageSize = format === "portrait"
        ? { width: isLowQuality ? 720 : 1080, height: isLowQuality ? 1280 : 1920 }
        : { width: isLowQuality ? 1280 : 1920, height: isLowQuality ? 720 : 1080 }

      await appendStepLog(step.id, `Модель: ${imageModelId}, размер: ${imageSize.width}x${imageSize.height}`)

      // subKey=scene.key — без него повторные итерации цикла reattach'или бы
      // к результату первой сцены (один step.id хранит один falRequestId).
      const result = await falStepRequest<FalImageResult>(step.id, imageModelId, {
        prompt: scene.prompt,
        image_size: imageSize,
        num_images: 1,
      }, scene.key)

      const imageUrl = result.images?.[0]?.url
      if (!imageUrl) throw new Error(`Не получено изображение для сцены ${scene.key}`)

      const imagePath = join(assetsDir, `${scene.key}_image.png`)
      await downloadFile(imageUrl, imagePath)
      imagePaths.push(imagePath)
      imageRemoteUrls.push(imageUrl)

      const imageStorage = await uploadLocalAsset(
        imagePath,
        StorageKeys.videoSceneImage(videoId, scene.order),
        "image/png",
      )

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
      outputSnapshot: { imagePaths, imageRemoteUrls, effectiveImageModel: imageModelId, renderQuality },
    })
    await appendStepLog(step.id, "Все изображения сгенерированы")

    return { imagePaths, imageRemoteUrls }
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
): Promise<string[]> {
  const step = await ensureStep(videoId, "clip_generation", 2)

  if (isStepCompleted(step) && step.outputSnapshot) {
    const output = step.outputSnapshot as { clipPaths?: string[] }
    // Пустой массив — законный результат: ролик целиком снят ведущей, генерировать
    // было нечего. Поэтому проверяем сам факт массива, а не его длину.
    if (Array.isArray(output.clipPaths)) return output.clipPaths
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
    appScreenRef?: { imageId: string; fileUrl: string } | null
    devicesInScene?: DeviceType[]
  }>

  // Pre-load AppReferenceImage записи по imageId сцен — нужны mimeType + локальный
  // файл для falUploadFile. Если запись удалена — сцена откатится на text-to-video.
  const screenRefsById = new Map<string, { id: string; appId: number; fileUrl: string; mimeType: string | null }>()
  if (isStoryDriven && storyPlan?.scenes?.length) {
    const screenIds = storyPlan.scenes
      .map(s => s.appScreenRef?.imageId)
      .filter((x): x is string => !!x)
    if (screenIds.length > 0) {
      const records = await prisma.appReferenceImage.findMany({
        where: { id: { in: screenIds } },
        select: { id: true, appId: true, fileUrl: true, mimeType: true },
      })
      for (const r of records) screenRefsById.set(r.id, r)
    }
  }

  if (isStoryDriven && prompts.scenePrompts?.scenes && prompts.scenePrompts.scenes.length > 0) {
    // ВАЖНО: key завязан на индекс цикла, а не на s.order из Claude. Если AI вернул
    // повторяющиеся order'ы, scene_X_clip.mp4 файлы коллизировали бы и переписывали
    // друг друга — на выходе один и тот же ролик. order для DB asset тоже = idx.
    scenes = prompts.scenePrompts.scenes.map((s, idx) => {
      const planScene = videoPlan.scenes.find(ps => ps.order === s.order)
      const sceneDuration = planScene?.durationSec ?? clipDuration

      // Сопоставление scene.appScreenRef из storyPlan (Claude order соответствует scenePrompt order).
      const storyScene = storyPlan?.scenes?.find(ps => ps.order === s.order)
      const ref = storyScene?.appScreenRef
      const refRecord = ref?.imageId ? screenRefsById.get(ref.imageId) : undefined
      // Fallback: если imageId был задан, но AppReferenceImage удалён (или
      // принадлежит другому app) — забываем привязку и идём text-to-video.
      // WARN остаётся в pipeline log для отладки.
      if (ref?.imageId && !refRecord) {
        console.warn(`[video-pipeline] Scene ${s.order}: AppReferenceImage ${ref.imageId} не найдена, fallback на text-to-video`)
      }
      const screenRef = ref && refRecord
        ? { imageId: ref.imageId, fileUrl: refRecord.fileUrl }
        : null

      return {
        key: `scene_${idx + 1}`,
        prompt: s.prompt,
        durationSec: sceneDuration,
        order: idx,
        appScreenRef: screenRef,
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

      const aspectRatio = format === "portrait" ? "9:16" : "16:9"

      // Image-to-video routing: если сцена привязана к существующему AppReferenceImage,
      // переключаемся на kling-video v2.1 standard image-to-video. Если запись была
      // удалена (refRecord === undefined в screenRefsById) — scene.appScreenRef уже
      // null после mapping, fallback на text-to-video. WARN залогирован отдельно.
      const useImageToVideo = !!scene.appScreenRef
      const sceneEndpoint = useImageToVideo ? KLING_IMAGE_TO_VIDEO_ENDPOINT : videoModelId

      const sceneNegativePrompt = buildNegativePromptForScene({
        devices: scene.devicesInScene,
        hasAppScreenRef: useImageToVideo,
      })

      let scenePayload: Record<string, unknown>
      if (useImageToVideo && scene.appScreenRef) {
        const refRecord = screenRefsById.get(scene.appScreenRef.imageId)!
        const localPath = resolveAppReferenceLocalPath(refRecord.appId, refRecord.fileUrl)
        const mediaType = detectAppReferenceMediaType(refRecord.mimeType, refRecord.fileUrl)
        await appendStepLog(step.id, `Сцена ${scene.key}: image-to-video через скриншот ${scene.appScreenRef.imageId}, заливаю в fal storage`)
        const publicImageUrl = await falUploadFile(localPath, mediaType)

        // Image-to-video v2.1 standard: duration ∈ {"5", "10"}. Реальная длина клипа
        // в timeline не меняется — assemble отрежет по originalDurationSec.
        const klingDuration = clampKlingI2vDuration(scene.durationSec)
        scenePayload = {
          prompt: scene.prompt,
          image_url: publicImageUrl,
          duration: klingDuration,
          aspect_ratio: aspectRatio,
          negative_prompt: sceneNegativePrompt,
        }
        await appendStepLog(step.id, `Сцена ${scene.key}: kling i2v duration=${klingDuration}s (исходно ${scene.durationSec}s)`)
      } else {
        scenePayload = buildClipPayload(videoModelId, {
          prompt: scene.prompt,
          durationSec: scene.durationSec,
          aspectRatio,
          negativePrompt: sceneNegativePrompt,
          generateAudio,
        })
      }

      if (scene.devicesInScene && scene.devicesInScene.length > 0) {
        await appendStepLog(step.id, `Сцена ${scene.key}: device-orientation negatives применены (devices: ${scene.devicesInScene.join(", ")})`)
      }

      await appendStepLog(step.id, `Генерирую клип: ${scene.key} (${scene.durationSec}s, ${sceneEndpoint}${useImageToVideo ? '' : `, audio: ${generateAudio}`})`)

      // subKey=scene.key — критично! Без него все 5 клипов получали бы результат
      // первого scene (reattach к одному falRequestId). User потерял $3 на это.
      const result = await falStepRequest<FalVideoResult>(
        step.id,
        sceneEndpoint,
        scenePayload,
        scene.key,
      )

      const videoUrl = result.video?.url
      if (!videoUrl) throw new Error(`Не получен клип для сцены ${scene.key}`)

      const clipPath = join(assetsDir, `${scene.key}_clip.mp4`)
      await downloadFile(videoUrl, clipPath)
      clipPaths.push(clipPath)

      const clipStorage = await uploadLocalAsset(
        clipPath,
        StorageKeys.videoSceneClip(videoId, scene.order),
        "video/mp4",
      )

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

    await updateStep(step.id, {
      status: "completed",
      finishedAt: new Date(),
      outputSnapshot: {
        clipPaths,
        effectiveVideoModel: videoModelId,
        generateAudio,
        perSceneDurations: scenes.map(s => ({ key: s.key, durationSec: s.durationSec })),
        presenterSceneIndexes: presenterSceneIndexes ? [...presenterSceneIndexes] : [],
      },
    })
    const generatedSeconds = scenes
      .filter(s => !presenterSceneIndexes?.has(s.order))
      .reduce((sum, sc) => sum + sc.durationSec, 0)
    await appendStepLog(step.id, presenterSceneIndexes?.size
      ? `Сгенерировано ${clipPaths.length} клипов (${generatedSeconds}s); ${presenterSceneIndexes.size} сцен отданы ведущей`
      : `Все клипы сгенерированы (total: ${generatedSeconds}s)`)

    return clipPaths
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
    reconciliation: 'none' | 'sped_up' | 'slowed_down' | 'trimmed' | 'skipped'
    speedFactor?: number
    warning?: string
  }>
  totalCostUsd: number
  provider: string | null
  modelId: string | null
  voiceId: string | null
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

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: step.attemptCount + 1,
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

  // Per-scene start times (из реальных clip durations — sceneIdx соответствует clip idx)
  const sceneStartTimes: number[] = []
  let currentStart = 0
  for (let i = 0; i < Math.max(scenes.length, clipDurations.length); i++) {
    sceneStartTimes.push(currentStart)
    const clipDur = clipDurations[i] ?? scenes[i]?.durationSec ?? 5
    currentStart += clipDur
  }

  const assetsDir = getAssetsDir(videoId)
  await ensureDir(assetsDir)

  const sceneResults: VoiceoverStepResult['sceneResults'] = []
  const audiosToMix: Array<{
    sceneOrder: number
    audioPath: string
    sceneStartSec: number
    voiceoverDurationSec: number
    sceneDurationSec: number
  }> = []
  let totalCost = 0
  let resolvedVoiceId = videoConfig.voiceoverVoiceId

  // 5. Per-scene synthesis + reconciliation
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!
    const line = lineByOrder.get(scene.order)
    const sceneDurationSec = clipDurations[i] ?? scene.durationSec

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

      if (videoConfig.voiceoverReconciliation === 'trim_audio') {
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
      sceneStartSec: sceneStartTimes[i] ?? 0,
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
      actualCost: totalCost,
    })
    await logStepCost(
      step.id,
      "voiceover_generation",
      mapStepKeyToService("voiceover_generation", ttsModel.id),
      totalCost,
      videoId,
      ttsModel.id,
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

  // 7. Build combined voiceover track
  const totalDurationSec = clipDurations.reduce((sum, d) => sum + d, 0) || scenes.reduce((sum, s) => sum + s.durationSec, 0)
  const mixPath = join(assetsDir, 'voiceover_mix.mp3')

  await appendStepLog(step.id, `Микширую ${audiosToMix.length} сегментов в единый voiceover track (${totalDurationSec}s)`)
  const mixResult = await buildVoiceoverTrack({
    scenes: audiosToMix,
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
  }

  await updateStep(step.id, {
    status: "completed",
    finishedAt: new Date(),
    outputSnapshot: result as unknown as Record<string, unknown>,
    actualCost: totalCost,
  })
  await logStepCost(
    step.id,
    "voiceover_generation",
    mapStepKeyToService("voiceover_generation", ttsModel.id),
    totalCost,
    videoId,
    ttsModel.id,
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
    /** Отрезки, где звучит закадровый голос — только там глушится звук клипов. */
    voiceoverIntervals?: Array<{ startSec: number; endSec: number }>
  },
): Promise<{ filePath: string; duration: number }> {
  const step = await ensureStep(videoId, "assembly", 5)

  const isStoryDriven = videoPlan && videoPlan.mode !== 'legacy_simple'

  let sceneSubtitles: Array<{ text: string; placement: SubtitlePlacement; durationSec: number }> | undefined
  // subtitleStyle: приоритет override (Video.subtitlesStyle) > videoPlan (storyPlan).
  // Это позволяет editor'у править Video.subtitlesStyle и видеть изменения в render
  // после rerunVideoStep('assembly') без модификации storyPlan.
  let subtitleStyle: SubtitleStyleProfile | null = extras?.subtitleStyleOverride ?? null

  if (isStoryDriven) {
    if (!subtitleStyle) subtitleStyle = videoPlan.subtitleStyle ?? null
    sceneSubtitles = videoPlan.scenes
      .filter(s => s.subtitleCopy)
      .map(s => ({
        text: s.subtitleCopy,
        placement: s.subtitlePlacement,
        durationSec: s.durationSec,
      }))
  }

  const hasSceneSubs = subtitlesEnabled && sceneSubtitles && sceneSubtitles.length > 0

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
    },
  })
  const hasVoiceover = !!extras?.voiceoverPath
  await appendStepLog(step.id, `Собираю видео: ${clipPaths.length} клипов, музыка: ${musicPath ? "да" : "нет"}, voiceover: ${hasVoiceover ? "да" : "нет"}, субтитры: ${subtitlesEnabled}${hasSceneSubs ? ` (${sceneSubtitles!.length} per-scene subs)` : ""}${subtitleStyle ? " (styled)" : ""}`)
  await updateVideoStatus(videoId, "assembling", { currentStep: "assembly" })

  // Keyword pre-pass — только для пресетов с needsKeywordDetection=true. При выключенных
  // paid-apis или ошибке агента — graceful degrade (фолбэк на эвристику внутри ass-builder).
  let keywordHints: Array<{ order: number; keywords: Array<{ word: string; weight: number }> }> | undefined
  if (subtitlesEnabled && hasSceneSubs && extras?.subtitlePreset) {
    const presetMeta = getPresetByKey(extras.subtitlePreset)
    if (presetMeta.needsKeywordDetection) {
      try {
        const segs = sceneSubtitles!.map((s, idx) => ({ order: idx + 1, text: s.text }))
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
    const result = await assembleVideo({
      clips: clipPaths,
      topText: subtitlesEnabled ? hookText : "",
      bottomText: subtitlesEnabled ? ctaText : "",
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
