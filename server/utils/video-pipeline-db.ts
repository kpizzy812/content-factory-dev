/**
 * Video Pipeline — DB helpers, lock management, fal.ai step request.
 *
 * Extracted from video-pipeline.ts for maintainability.
 * All functions are internal to the video pipeline module.
 */

import type { FalRequestMeta } from "./fal"
import { falReattach } from "./fal"
import type { SceneImagePrompts } from "./video-helpers"
import type { VideoRuntimeMode } from "~~/shared/types/video-runtime"

// ─── Types ────────────────────────────────────────────────────────

export interface FalImageResult {
  images: Array<{ url: string }>
}

export interface FalVideoResult {
  video: { url: string }
}

export type StepKey = "prompt_generation" | "image_generation" | "clip_generation" | "voiceover_generation" | "music_generation" | "lip_sync_generation" | "assembly"

export const STEP_ORDER: StepKey[] = [
  "prompt_generation",
  "image_generation",
  "clip_generation",
  "voiceover_generation",
  "music_generation",
  "lip_sync_generation",
  "assembly",
]

/** Результат генерации промптов — либо legacy (3 промпта), либо scene-level */
export interface PromptGenerationResult {
  hook: string
  body: string
  cta: string
  scenePrompts?: SceneImagePrompts
  storySceneCount?: number
  runtimeMode?: VideoRuntimeMode
}

// ─── Lock management ──────────────────────────────────────────────

// In-memory tracking дополняет DB lock — быстрая проверка без round-trip
const activePipelines = new Set<number>()

/**
 * Блокирует video job для предотвращения параллельных запусков.
 * Атомарный DB-level lock: updateMany с WHERE isLocked=false гарантирует,
 * что только один процесс захватит lock даже при concurrent requests.
 * In-memory Set — быстрая проверка без round-trip для этого инстанса.
 */
export async function acquireLock(videoId: number): Promise<boolean> {
  if (activePipelines.has(videoId)) return false

  // Atomic DB claim: only succeeds if isLocked is currently false
  const claimed = await prisma.video.updateMany({
    where: { id: videoId, isLocked: false },
    data: { isLocked: true, lockedAt: new Date(), lockedReason: "pipeline_running" },
  })

  if (claimed.count === 0) return false

  activePipelines.add(videoId)
  return true
}

/**
 * Снимает блокировку video job.
 */
export async function releaseLock(videoId: number): Promise<void> {
  activePipelines.delete(videoId)
  await prisma.video.update({
    where: { id: videoId },
    data: { isLocked: false, lockedAt: null, lockedReason: null },
  }).catch(() => {})
}

// ─── DB helpers ───────────────────────────────────────────────────

export async function updateVideoStatus(
  videoId: number,
  status: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await prisma.video.update({
    where: { id: videoId },
    data: { status: status as never, ...extra },
  })
}

export async function ensureStep(videoId: number, stepKey: StepKey, stepIndex: number) {
  const existing = await prisma.videoGenerationStep.findFirst({
    where: { videoId, stepKey: stepKey as never },
  })

  if (existing) return existing

  return prisma.videoGenerationStep.create({
    data: {
      videoId,
      stepKey: stepKey as never,
      stepIndex,
      status: "pending" as never,
    },
  })
}

export async function updateStep(
  stepId: number,
  data: Record<string, unknown>,
): Promise<void> {
  await prisma.videoGenerationStep.update({
    where: { id: stepId },
    data: data as never,
  })
}

export async function appendStepLog(stepId: number, message: string): Promise<void> {
  const step = await prisma.videoGenerationStep.findUnique({ where: { id: stepId } })
  const logs = (step?.logs as Array<{ ts: string; msg: string }>) || []
  logs.push({ ts: new Date().toISOString(), msg: message })
  await updateStep(stepId, { logs })
}

export function isStepCompleted(step: { status: string }): boolean {
  return step.status === "completed"
}

// ─── fal.ai step request ──────────────────────────────────────────

/**
 * Выполняет fal.ai запрос с персистентным трекингом шага.
 *
 * Reattach контракт:
 *  - Если шаг делает ОДИН fal.ai job (image/music) — subKey не передаётся, reattach
 *    срабатывает на любой сохранённый falRequestId (защита от двойных списаний при retry).
 *  - Если шаг делает СЕРИЮ fal.ai jobs (per-scene clips) — обязательно subKey="scene_N".
 *    Reattach срабатывает только если сохранённый falSubKey === current subKey, иначе
 *    свежий submit. Без этого все сцены получали бы результат первой сцены (один step.id
 *    хранит один falRequestId), что приводило к 5 идентичным клипам и двойному расходу.
 */
export async function falStepRequest<T>(
  stepId: number,
  endpoint: string,
  input: object,
  subKey?: string,
): Promise<T> {
  const statusCallback = async (statusResponse: { status: string; logs?: unknown }) => {
    await updateStep(stepId, {
      falQueueStatus: statusResponse.status,
      falLogsSnapshot: statusResponse.logs || null,
    })
  }

  // Попытка reattach к существующему remote job
  const existingStep = await prisma.videoGenerationStep.findUnique({ where: { id: stepId } })
  const subKeyMatch = (existingStep?.falSubKey ?? null) === (subKey ?? null)
  if (existingStep?.falRequestId && existingStep.falEndpoint && subKeyMatch) {
    await appendStepLog(stepId, `Reattach к fal.ai job ${existingStep.falRequestId}${subKey ? ` (${subKey})` : ''}`)
    await updateStep(stepId, { falQueueStatus: "REATTACHING" })

    const reattachResult = await falReattach<T>(
      existingStep.falEndpoint,
      existingStep.falRequestId,
      statusCallback,
    )

    if (reattachResult) {
      await updateStep(stepId, {
        falQueueStatus: "COMPLETED",
        falCompletedAt: reattachResult.completedAt,
        falResultUrl: typeof (reattachResult.data as Record<string, unknown>)?.url === "string"
          ? (reattachResult.data as Record<string, unknown>).url
          : null,
      })
      await appendStepLog(stepId, `Reattach успешен — результат получен`)
      return reattachResult.data
    }

    await appendStepLog(stepId, `Reattach не удался — запускаю новый fal.ai запрос`)
  } else if (existingStep?.falRequestId && !subKeyMatch) {
    // У step'а уже есть job, но от другой сцены — игнорируем, делаем свежий submit
    await appendStepLog(stepId, `Сохранённый fal.ai job от ${existingStep.falSubKey ?? 'другой сцены'}, текущая=${subKey ?? '(none)'} — submit нового запроса`)
  }

  // Новый submit
  const meta: FalRequestMeta = await falSubmit(endpoint, input)

  await updateStep(stepId, {
    falRequestId: meta.requestId,
    falEndpoint: endpoint,
    falSubKey: subKey ?? null,
    falSubmittedAt: meta.submittedAt,
    falQueueStatus: "IN_QUEUE",
  })

  // Poll с обновлением статуса
  const result = await falPollUntilDone<T>(
    endpoint,
    meta.requestId,
    statusCallback,
  )

  await updateStep(stepId, {
    falQueueStatus: "COMPLETED",
    falCompletedAt: result.completedAt,
    falResultUrl: typeof (result.data as Record<string, unknown>)?.url === "string"
      ? (result.data as Record<string, unknown>).url
      : null,
  })

  return result.data
}
