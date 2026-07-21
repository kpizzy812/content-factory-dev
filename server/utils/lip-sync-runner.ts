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

import { basename, join } from "node:path"
import { mkdir, unlink } from "node:fs/promises"
import { prisma } from "./prisma"
import { ensureStep, updateStep, appendStepLog, isStepCompleted, type StepKey } from "./video-pipeline-db"
import { updateVideoStatus } from "./video-pipeline-db"
import { synthesizeSpeech } from "./tts"
import { falSubmit, falPollUntilDone, falUploadFile } from "./fal"
import { withTimeoutAndRetry } from "./external-call"
import { downloadFile } from "./video-helpers"
import { getModel, getDefaultLipSyncModel } from "./video-models"
import { getAssetsDirFor } from "./storage-paths"
import { StorageKeys } from "./storage/keys"
import { uploadLocalAsset } from "./storage/persist-asset"
import { storageKeyToLegacyUrl } from "./storage/download-to-storage"
import { logStepCost } from "./balance/cost-ledger"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"

const STEP_KEY: StepKey = "lip_sync_generation"
const STEP_ORDER_INDEX = 5

interface FalLipSyncResult {
  video: { url: string }
}

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

  // Idempotency: уже завершён
  if (isStepCompleted(step) && step.outputSnapshot) {
    const cached = step.outputSnapshot as unknown as LipSyncStepResult
    if (Array.isArray(cached.clipPaths) && cached.clipPaths.length === clipPaths.length) {
      return cached
    }
  }

  // Resolve lip-sync model
  const preferredId = videoConfig.lipSyncModelId
  const model = (preferredId ? getModel(preferredId) : null) ?? getDefaultLipSyncModel()
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
  const audioCleanup: string[] = []
  const assetsDir = getAssetsDirFor(videoId)
  await mkdir(assetsDir, { recursive: true })

  for (const scene of lipSyncTargets) {
    // Находим клип для этой сцены через VideoAsset.order = scene.order.
    const clipAsset = await prisma.videoAsset.findFirst({
      where: { videoId, type: "clip" as never, order: scene.order },
    })
    if (!clipAsset?.filePath) {
      await appendStepLog(step.id, `Scene ${scene.order}: не найден клип в БД, пропускаю`)
      continue
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
      })
      ttsCost = tts.costUsd
      audioCleanup.push(audioPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "TTS failed"
      await appendStepLog(step.id, `Scene ${scene.order}: TTS ошибка (${msg}) — оставляю оригинальный клип`)
      continue
    }

    // 2. Загружаем клип и аудио в fal storage.
    let videoUrl: string
    let audioUrl: string
    try {
      ;[videoUrl, audioUrl] = await Promise.all([
        falUploadFile(clipAsset.filePath, "video/mp4"),
        falUploadFile(audioPath, "audio/mpeg"),
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fal upload failed"
      await appendStepLog(step.id, `Scene ${scene.order}: fal upload ошибка (${msg}) — оставляю оригинальный клип`)
      continue
    }

    // 3. Submit lip-sync. Hard timeout 10 минут per attempt + 2 попытки.
    // Lip-sync обычно занимает 30-90 секунд, но queue + processing могут затянуть до 5 минут.
    // 10 минут с большим запасом, чтобы зависший fal.ai не блокировал pipeline forever.
    let lipSyncedUrl: string | null = null
    try {
      const result = await withTimeoutAndRetry<{ data: FalLipSyncResult | undefined }>(
        async () => {
          const meta = await falSubmit(model.id, {
            video_url: videoUrl,
            audio_url: audioUrl,
            sync_mode: "cut_off",
          })
          return await falPollUntilDone<FalLipSyncResult>(model.id, meta.requestId)
        },
        {
          label: `Lip-sync scene_${scene.order}`,
          timeoutMs: 10 * 60 * 1000,
          maxRetries: 2,
          initialBackoffMs: 3000,
          onRetry: (attempt, err, delayMs) => {
            const m = err instanceof Error ? err.message : String(err)
            console.warn(`[lip-sync] scene ${scene.order} attempt ${attempt} failed: ${m}. Retry in ${delayMs}ms`)
          },
        },
      )
      lipSyncedUrl = result.data?.video?.url ?? null
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fal sync-lipsync failed"
      await appendStepLog(step.id, `Scene ${scene.order}: lip-sync ошибка (${msg}) — оставляю оригинальный клип`)
      continue
    }

    if (!lipSyncedUrl) {
      await appendStepLog(step.id, `Scene ${scene.order}: модель не вернула url — оставляю оригинальный клип`)
      continue
    }

    // 4. Скачиваем lip-synced клип, заменяем оригинал на месте.
    const lipSyncedPath = join(assetsDir, `scene_${scene.order}_lipsync.mp4`)
    try {
      await downloadFile(lipSyncedUrl, lipSyncedPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "download failed"
      await appendStepLog(step.id, `Scene ${scene.order}: скачивание lip-synced клипа упало (${msg}) — оставляю оригинальный`)
      continue
    }

    // Заливаем lip-synced клип в storage и обновляем VideoAsset.
    const lipSyncStorage = await uploadLocalAsset(
      lipSyncedPath,
      StorageKeys.videoLipSyncClip(videoId, basename(lipSyncedPath)),
      "video/mp4",
    )
    await prisma.videoAsset.update({
      where: { id: clipAsset.id },
      data: {
        filePath: lipSyncedPath,
        fileUrl: storageKeyToLegacyUrl(lipSyncStorage.storageKey),
        ...lipSyncStorage,
      },
    })

    const idx = updatedClipPaths.findIndex(p => p === clipAsset.filePath)
    if (idx >= 0) updatedClipPaths[idx] = lipSyncedPath

    // Цена: per-second of output (обычно clip duration).
    const sceneSec = scene.durationSec || 5
    const lipSyncCost = sceneSec * model.pricing.base
    totalCostUsd += lipSyncCost + ttsCost
    syncedSceneCount++
    await appendStepLog(step.id, `Scene ${scene.order}: lip-sync завершён за ${sceneSec}s (lip $${lipSyncCost.toFixed(3)} + tts $${ttsCost.toFixed(3)})`)
  }

  // Cleanup временных аудиофайлов.
  await Promise.allSettled(audioCleanup.map(p => unlink(p).catch(() => {})))

  const result: LipSyncStepResult = {
    status: "completed",
    clipPaths: updatedClipPaths,
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
  // balance_v2 cost ledger: lip-sync шаг = fal.ai по mapStepKeyToService.
  // Логируем суммарный totalCostUsd (lip-sync API + дополнительный TTS spokenLine).
  // Это НЕ дублирует voiceover_generation: stepKey разные (lip_sync_generation vs voiceover_generation),
  // и spokenLine это off-screen narrator-replacement, отдельный от voiceoverPlan.lines который
  // обрабатывает runVoiceoverGeneration. Idempotency check (videoId, stepKey, service) разводит пары.
  await logStepCost(
    step.id,
    STEP_KEY,
    "fal.ai",
    totalCostUsd,
    videoId,
    model.id,
  )
  await appendStepLog(step.id, `Lip-sync завершён: ${syncedSceneCount} из ${lipSyncTargets.length} сцен синхронизировано, стоимость $${totalCostUsd.toFixed(3)}`)

  return result
}
