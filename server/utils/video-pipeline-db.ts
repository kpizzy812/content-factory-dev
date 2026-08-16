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
import { appendAndTrimStepLogs, buildStepLogEntry, STEP_LOG_LIMIT } from "./video-pipeline-log"
import { createLockRegistry, type PipelineLockHandle } from "./video-pipeline-lock"

export type { PipelineLockHandle } from "./video-pipeline-lock"

// ─── Types ────────────────────────────────────────────────────────

export interface FalImageResult {
  images: Array<{ url: string }>
}

export interface FalVideoResult {
  video: { url: string }
}

export type StepKey = "prompt_generation" | "image_generation" | "clip_generation" | "voiceover_generation" | "music_generation" | "lip_sync_generation" | "assembly" | "transcription"

/**
 * Порядок шагов для персистентного stepIndex и сортировки в UI.
 *
 * ВНИМАНИЕ: это НЕ порядок выполнения — lip-sync фактически идёт шагом 4b, между
 * клипами и озвучкой. Каскад перезапуска считается по STEP_EXECUTION_ORDER /
 * STEP_EXECUTION_ORDER_AUDIO_FIRST из video-pipeline-run-policy.ts; здесь порядок
 * зафиксирован историей уже записанных VideoGenerationStep.stepIndex и трогать
 * его нельзя.
 */
export const STEP_ORDER: StepKey[] = [
  "prompt_generation",
  "image_generation",
  "clip_generation",
  "voiceover_generation",
  "music_generation",
  "lip_sync_generation",
  "assembly",
  // Дописан в конец намеренно: stepIndex персистентный, по нему записана
  // история роликов, и вставка в середину переписала бы её.
  "transcription",
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

/**
 * Кто из прогонов ЭТОГО процесса владеет блокировкой ролика.
 * Штамп выдаётся на прогон, а не на videoId, — см. video-pipeline-lock.ts:
 * иначе finally отменённого прогона снимал блокировку с нового запуска.
 */
const lockRegistry = createLockRegistry()

/** Значение lockedReason у блокировки, которую ставит сам pipeline. */
const PIPELINE_LOCK_REASON = "pipeline_running"

/**
 * Блокирует video job для предотвращения параллельных запусков.
 * Атомарный DB-level lock: updateMany с WHERE isLocked=false гарантирует,
 * что только один процесс захватит lock даже при concurrent requests.
 * Реестр в памяти — быстрая проверка без round-trip для этого инстанса.
 *
 * Возвращает токен владения; null — блокировку взять не удалось. Токен нужно
 * донести до releaseLock, иначе прогон разлочит не свою запись.
 */
export async function acquireLock(videoId: number): Promise<PipelineLockHandle | null> {
  const handle = lockRegistry.claim(videoId, Date.now())
  if (!handle) return null

  // Atomic DB claim: only succeeds if isLocked is currently false.
  // lockedAt — тот же штамп: по нему прогон потом узнает СВОЮ блокировку в БД.
  const claimed = await prisma.video.updateMany({
    where: { id: videoId, isLocked: false },
    data: { isLocked: true, lockedAt: new Date(handle.stampMs), lockedReason: PIPELINE_LOCK_REASON },
  })

  if (claimed.count === 0) {
    lockRegistry.release(handle)
    return null
  }

  return handle
}

/**
 * Снимает блокировку, взятую этим прогоном.
 *
 * Двойная сверка владения: реестр процесса (тот же ролик мог уже перехватить
 * новый прогон после отмены) и lockedAt в БД (владелец мог смениться в другом
 * процессе). Не наш штамп — не наша блокировка, молча уходим.
 */
export async function releaseLock(handle: PipelineLockHandle): Promise<void> {
  // false — блокировку сорвали отменой и/или ею уже владеет другой прогон.
  if (!lockRegistry.release(handle)) return

  await prisma.video.updateMany({
    where: { id: handle.videoId, lockedAt: new Date(handle.stampMs) },
    data: { isLocked: false, lockedAt: null, lockedReason: null },
  }).catch(() => {})
}

/**
 * Осознанный срыв блокировки — путь отмены.
 * Прогон, который её держит, ещё крутится в другом контексте и сам не разлочит,
 * а оператору нужно иметь возможность запустить ролик заново.
 */
export async function forceReleaseLock(videoId: number): Promise<void> {
  lockRegistry.forceRelease(videoId)
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

/**
 * Дописывает строку в лог шага.
 *
 * Одним UPDATE-ом прямо в jsonb: раньше было read-modify-write (findUnique →
 * push → update), и параллельные записи затирали друг друга — а пишут в один шаг
 * из нескольких мест сразу (runner сцены, колбэк статуса fal-очереди, reattach),
 * так что терялись именно те строки, ради которых в лог и лезут.
 *
 * Хвост массива обрезается тем же запросом до STEP_LOG_LIMIT записей.
 * Значения передаются параметрами ($1..$4), склейки строк в SQL нет.
 */
export async function appendStepLog(stepId: number, message: string): Promise<void> {
  const entry = buildStepLogEntry(message)

  try {
    await prisma.$executeRaw`
      UPDATE "VideoGenerationStep" AS s
      SET "logs" = (
        SELECT COALESCE(jsonb_agg(e.entry ORDER BY e.ord), '[]'::jsonb)
        FROM (
          SELECT entry, ord
          FROM jsonb_array_elements(
            (CASE WHEN jsonb_typeof(s."logs") = 'array' THEN s."logs" ELSE '[]'::jsonb END)
            || jsonb_build_array(jsonb_build_object('ts', ${entry.ts}::text, 'msg', ${entry.msg}::text))
          ) WITH ORDINALITY AS t(entry, ord)
          ORDER BY ord DESC
          LIMIT ${STEP_LOG_LIMIT}
        ) AS e
      )
      WHERE s."id" = ${stepId}
    `
  }
  catch (error) {
    // Логи не тот повод, чтобы валить генерацию: при недоступном raw-пути
    // (мок prisma в тестах, нештатный драйвер) откатываемся на старый
    // read-modify-write — он гоночный, но лучше, чем потерянная запись.
    console.warn(
      `[video-pipeline] атомарная запись лога шага ${stepId} не прошла, fallback: ${error instanceof Error ? error.message : String(error)}`,
    )
    try {
      const step = await prisma.videoGenerationStep.findUnique({ where: { id: stepId } })
      await updateStep(stepId, { logs: appendAndTrimStepLogs(step?.logs, entry) })
    }
    catch { /* лог шага — не критичен */ }
  }
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
