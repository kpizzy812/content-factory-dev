/**
 * Lip-Sync Runner — премиум-шаг между clip_generation и assembly.
 *
 * Для каждой сцены, у которой в storyPlan есть spokenLine и в кадре person-протагонист,
 * runner синтезирует TTS, аплоудит готовый клип + аудио в fal storage и вызывает
 * sync-lipsync. Результат заменяет оригинальный клип, дальнейший пайплайн получает
 * lip-synced версию и собирает финальное видео.
 *
 * Гейт: video.lipSyncEnabled === true. Пресет quality включает по умолчанию,
 * budget/balanced — нет.
 */

import { basename, extname, join } from "node:path"
import { mkdir, unlink } from "node:fs/promises"
import { prisma } from "./prisma"
import { ensureStep, updateStep, appendStepLog, isStepCompleted, type StepKey } from "./video-pipeline-db"
import { updateVideoStatus } from "./video-pipeline-db"
import { synthesizeSpeech } from "./tts"
import { runLipSync } from "./media-provider/lip-sync"
import { getModel, getDefaultLipSyncModel } from "./video-models"
import { getAssetsDirFor } from "./storage-paths"
import { StorageKeys } from "./storage/keys"
import { uploadLocalAsset } from "./storage/persist-asset"
import { storageKeyToLegacyUrl } from "./storage/download-to-storage"
import { getStorageDriver } from "./storage"
import { downloadFile } from "./video-helpers"
import { reservePresenterSourceClip } from "./presenter-source-selector"
import { logStepCost } from "./balance/cost-ledger"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const STEP_KEY: StepKey = "lip_sync_generation"
const STEP_ORDER_INDEX = 5

export interface LipSyncStepResult {
  /** 'disabled' — фича выключена; 'skipped' — нет сцен с spokenLine; 'completed' — успех */
  status: "disabled" | "skipped" | "completed"
  /** Обновлённые пути клипов (lip-synced где применимо, оригиналы где нет) */
  clipPaths: string[]
  /** Сколько сцен реально синхронизировано */
  syncedSceneCount: number
  /** Суммарная стоимость lip-sync (USD) */
  totalCostUsd: number
  /** ID lip-sync модели */
  modelId: string | null
}

export interface LipSyncStepInput {
  videoId: number
  clipPaths: string[]
  videoPlan: StoryDrivenVideoPlan | null
  videoConfig: {
    lipSyncEnabled: boolean
    lipSyncModelId: string | null
    lipSyncCharacterId: string | null
    voiceoverModelId: string | null
    voiceoverVoiceId: string | null
    voiceoverLanguage: string
    voiceoverPacing: "slow" | "moderate" | "fast"
  }
}

export async function runLipSyncStep(input: LipSyncStepInput): Promise<LipSyncStepResult> {
  const { videoId, clipPaths, videoPlan, videoConfig } = input
  const step = await ensureStep(videoId, STEP_KEY, STEP_ORDER_INDEX)

  // Gate 1: feature off
  if (!videoConfig.lipSyncEnabled) {
    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
      outputSnapshot: { reason: "lip_sync_disabled_by_config" },
    })
    await appendStepLog(step.id, "Lip-sync отключён в конфиге (lipSyncEnabled=false)")
    return { status: "disabled", clipPaths, syncedSceneCount: 0, totalCostUsd: 0, modelId: null }
  }

  // Gate 2: нет storyPlan/scenes с spokenLine
  const isStoryDriven = videoPlan && videoPlan.mode !== "legacy_simple"
  const sceneUnits = isStoryDriven ? videoPlan.scenes : []
  const lipSyncTargets = sceneUnits.filter(s => s.spokenLine && s.spokenLine.trim().length > 0)

  if (lipSyncTargets.length === 0) {
    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
      outputSnapshot: { reason: isStoryDriven ? "no_spoken_lines" : "legacy_mode_no_lip_sync" },
    })
    await appendStepLog(step.id, isStoryDriven
      ? "В storyPlan нет ни одной сцены с spokenLine — нечего синхронизировать"
      : "Legacy mode (без StoryPlan) — lip-sync недоступен")
    return { status: "skipped", clipPaths, syncedSceneCount: 0, totalCostUsd: 0, modelId: null }
  }

  // Idempotency: уже завершён. Длину входного массива с результатом не сверяем —
  // сцены ведущей приходят сюда без готового клипа, и списки заведомо разной длины.
  if (isStepCompleted(step) && step.outputSnapshot) {
    const cached = step.outputSnapshot as unknown as LipSyncStepResult
    if (Array.isArray(cached.clipPaths) && cached.clipPaths.length > 0) {
      return cached
    }
  }

  // Resolve lip-sync model
  const preferredId = videoConfig.lipSyncModelId
  const preferredModel = preferredId ? getModel(preferredId) : null
  const model = preferredModel?.integrated
    && preferredModel.provider.toLowerCase().includes("replicate")
    ? preferredModel
    : getDefaultLipSyncModel()
  if (!model || model.task !== "lip_sync") {
    await updateStep(step.id, {
      status: "skipped",
      finishedAt: new Date(),
      outputSnapshot: { reason: "no_integrated_lip_sync_model" },
    })
    await appendStepLog(step.id, "Lip-sync включён, но не найдена интегрированная модель — пропускаю")
    return { status: "skipped", clipPaths, syncedSceneCount: 0, totalCostUsd: 0, modelId: null }
  }

  await updateStep(step.id, {
    status: "running",
    startedAt: new Date(),
    attemptCount: step.attemptCount + 1,
  })
  await updateVideoStatus(videoId, "assembling", { currentStep: STEP_KEY })
  await appendStepLog(step.id, `Lip-sync: ${lipSyncTargets.length} сцен, модель ${model.id}`)

  const updatedClipPaths = [...clipPaths]
  let syncedSceneCount = 0
  let totalCostUsd = 0
  const costByService = new Map<"replicate" | "fal.ai", number>()
  const audioCleanup: string[] = []
  const sourceCleanup: string[] = []
  const assetsDir = getAssetsDirFor(videoId)
  await mkdir(assetsDir, { recursive: true })

  for (const scene of lipSyncTargets) {
    // Клип сцены адресуется позицией в плане, а не полем order из сценария:
    // именно так его записывает clip_generation, и именно так его ждёт сборка.
    const sceneIndex = sceneUnits.indexOf(scene)
    const clipAsset = await prisma.videoAsset.findFirst({
      where: { videoId, type: "clip" as never, order: sceneIndex },
    })

    // Основной путь: исходник берётся из живой библиотеки, а не из платной
    // генерации. Сгенерированный клип используется только как запасной вариант
    // для старых видео, где сцена уже была оплачена.
    let sourceVideoPath: string | null = null
    if (videoConfig.lipSyncCharacterId) {
      const sourceClip = await reservePresenterSourceClip({
        characterId: videoConfig.lipSyncCharacterId,
        durationSec: scene.durationSec || 5,
      })
      if (sourceClip) {
        const sourceExt = extname(sourceClip.name || sourceClip.fileUrl).toLowerCase()
        const safeExt = [".mp4", ".mov", ".webm"].includes(sourceExt) ? sourceExt : ".mp4"
        const localSourcePath = join(assetsDir, `presenter_${sceneIndex}_${sourceClip.id}${safeExt}`)
        if (sourceClip.storageKey) {
          await getStorageDriver().downloadToFile(sourceClip.storageKey, localSourcePath)
        } else {
          await downloadFile(sourceClip.fileUrl, localSourcePath)
        }
        sourceVideoPath = localSourcePath
        sourceCleanup.push(localSourcePath)
        await appendStepLog(step.id, `Scene ${scene.order}: presenter source ${sourceClip.id}`)
      } else {
        await appendStepLog(step.id, `Scene ${scene.order}: нет активных фрагментов ведущего`)
      }
    }
    if (!sourceVideoPath) sourceVideoPath = clipAsset?.filePath ?? null
    if (!sourceVideoPath) {
      // Сцену снимала ведущая, поэтому клипа под неё не генерировали. Без исходника
      // в ролике осталась бы дыра — честнее уронить шаг, чем собрать видео без сцены.
      throw new Error(
        `Scene ${scene.order}: нет ни фрагмента ведущего, ни сгенерированного клипа — собирать нечего`,
      )
    }
    // 1. TTS spokenLine — отдельный синтез, не трогает voiceoverPlan (off-screen narrator).
    const audioPath = join(assetsDir, `scene_${scene.order}_spoken.mp3`)
    let ttsCost = 0
    try {
      const tts = await synthesizeSpeech({
        text: scene.spokenLine!,
        outputPath: audioPath,
        modelId: videoConfig.voiceoverModelId,
        voiceId: videoConfig.voiceoverVoiceId,
        language: videoConfig.voiceoverLanguage,
        pacing: videoConfig.voiceoverPacing,
        videoId,
      })
      ttsCost = tts.costUsd
      audioCleanup.push(audioPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "TTS failed"
      if (!clipAsset?.filePath) throw new Error(`Scene ${scene.order}: TTS ошибка (${msg})`)
      await appendStepLog(step.id, `Scene ${scene.order}: TTS ошибка (${msg}) — оставляю оригинальный клип`)
      continue
    }

    // 2. Replicate по умолчанию; fal.ai доступен только как явно включённый fallback.
    const sceneSec = scene.durationSec || 5
    const lipSyncedPath = join(assetsDir, `scene_${scene.order}_lipsync.mp4`)
    let lipSyncResult: Awaited<ReturnType<typeof runLipSync>>
    try {
      lipSyncResult = await runLipSync({
        videoId,
        videoAssetId: clipAsset?.id ?? null,
        sceneOrder: sceneIndex,
        sourceVideoPath,
        audioPath,
        outputPath: lipSyncedPath,
        durationSec: sceneSec,
        modelId: model.id,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "lip-sync failed"
      if (!clipAsset?.filePath) throw new Error(`Scene ${scene.order}: lip-sync ошибка (${msg})`)
      await appendStepLog(step.id, `Scene ${scene.order}: lip-sync ошибка (${msg}) — оставляю оригинальный клип`)
      continue
    }

    // Заливаем lip-synced клип в storage. Для сцены ведущей записи ещё нет —
    // clip_generation её не создавал, потому что не генерировал клип.
    const lipSyncStorage = await uploadLocalAsset(
      lipSyncedPath,
      StorageKeys.videoLipSyncClip(videoId, basename(lipSyncedPath)),
      "video/mp4",
    )
    if (clipAsset) {
      await prisma.videoAsset.update({
        where: { id: clipAsset.id },
        data: {
          filePath: lipSyncedPath,
          fileUrl: storageKeyToLegacyUrl(lipSyncStorage.storageKey),
          ...lipSyncStorage,
        },
      })
    } else {
      await prisma.videoAsset.create({
        data: {
          videoId,
          type: "clip" as never,
          prompt: scene.spokenLine!.slice(0, 500),
          filePath: lipSyncedPath,
          fileUrl: storageKeyToLegacyUrl(lipSyncStorage.storageKey),
          order: sceneIndex,
          duration: sceneSec,
          ...lipSyncStorage,
        },
      })
    }

    const lipSyncCost = lipSyncResult.costUsd
    const service = lipSyncResult.provider === "replicate" ? "replicate" : "fal.ai"
    costByService.set(service, (costByService.get(service) ?? 0) + lipSyncCost + ttsCost)
    totalCostUsd += lipSyncCost + ttsCost
    syncedSceneCount++
    await appendStepLog(step.id, `Scene ${scene.order}: ${lipSyncResult.provider} lip-sync завершён за ${sceneSec}s (lip $${lipSyncCost.toFixed(3)} + tts $${ttsCost.toFixed(3)})`)
  }

  // Cleanup временных аудиофайлов.
  await Promise.allSettled([...audioCleanup, ...sourceCleanup].map(p => unlink(p).catch(() => {})))

  // Итоговый список собираем из БД по порядку сцен, а не правкой входного массива:
  // клипы сцен ведущей создаются здесь же и во входном массиве их не было.
  const clipAssets = await prisma.videoAsset.findMany({
    where: { videoId, type: "clip" as never },
    orderBy: { order: "asc" },
    select: { filePath: true },
  })
  const orderedClipPaths = clipAssets
    .map(asset => asset.filePath)
    .filter((path): path is string => !!path)

  const result: LipSyncStepResult = {
    status: "completed",
    clipPaths: orderedClipPaths.length > 0 ? orderedClipPaths : updatedClipPaths,
    syncedSceneCount,
    totalCostUsd,
    modelId: model.id,
  }

  await updateStep(step.id, {
    status: "completed",
    finishedAt: new Date(),
    outputSnapshot: result as unknown as Record<string, unknown>,
    actualCost: totalCostUsd,
  })
  for (const [service, costUsd] of costByService) {
    await logStepCost(step.id, STEP_KEY, service, costUsd, videoId, model.id)
  }
  await appendStepLog(step.id, `Lip-sync завершён: ${syncedSceneCount} из ${lipSyncTargets.length} сцен синхронизировано, стоимость $${totalCostUsd.toFixed(3)}`)

  return result
}
