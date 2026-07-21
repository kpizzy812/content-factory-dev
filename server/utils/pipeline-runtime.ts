/**
 * Pipeline Runtime Governor — Hardened Single-Instance Mode.
 *
 * Production-grade execution orchestration:
 * - Bounded system-wide concurrency (max concurrent runs)
 * - Run queue with pending → running lifecycle
 * - Lease heartbeat for active runs
 * - Atomic run claiming via DB transaction (safe under concurrent requests)
 * - Orphan/stuck detection with automatic recovery
 * - Recovery after process restart
 * - Duplicate run prevention at system level
 * - Instance identity for diagnostics
 * - Runtime mode visibility (single-instance hardened)
 *
 * Architecture note:
 * This is a hardened single-instance runtime. All queue and heartbeat state
 * lives in-memory within this process + Prisma DB. For true distributed
 * multi-instance execution, an external queue (Redis/BullMQ) would be required.
 * The current model is production-safe for single-server deployments.
 */

import { executePipeline, detectStuckRuns } from './pipeline-engine'
import { prisma } from './prisma'
import { logAgent } from './agent-logger'
import { randomUUID } from 'node:crypto'

const MAX_CONCURRENT_RUNS = Number(process.env.PIPELINE_MAX_CONCURRENT_RUNS) || 5
const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_STALE_MS = 90_000 // 3x heartbeat = considered dead
const QUEUE_POLL_INTERVAL_MS = 5_000

/** Unique instance identifier — survives only for this process lifecycle. */
const INSTANCE_ID = `inst-${randomUUID().slice(0, 8)}-${process.pid}`

/** Runtime mode descriptor. */
export type RuntimeMode = 'single_instance_hardened'

/** In-memory tracking of active runs with heartbeat. */
const activeRuns = new Map<number, { startedAt: number; lastHeartbeat: number }>()
let queuePollingActive = false

/** Register a run as active (for concurrency tracking). */
export function registerActiveRun(runId: number): boolean {
  if (activeRuns.size >= MAX_CONCURRENT_RUNS) {
    return false
  }
  const now = Date.now()
  activeRuns.set(runId, { startedAt: now, lastHeartbeat: now })
  return true
}

/** Deregister a completed/failed/cancelled run. */
export function deregisterActiveRun(runId: number): void {
  activeRuns.delete(runId)
}

/** Update heartbeat for an active run. */
export function heartbeatRun(runId: number): void {
  const entry = activeRuns.get(runId)
  if (entry) {
    entry.lastHeartbeat = Date.now()
  }
}

/** Get current runtime stats with extended info. */
export function getRuntimeStats(): {
  activeRuns: number
  maxConcurrent: number
  runIds: number[]
  instanceId: string
  runtimeMode: RuntimeMode
  uptimeMs: number
} {
  return {
    activeRuns: activeRuns.size,
    maxConcurrent: MAX_CONCURRENT_RUNS,
    runIds: Array.from(activeRuns.keys()),
    instanceId: INSTANCE_ID,
    runtimeMode: 'single_instance_hardened',
    uptimeMs: Math.floor(process.uptime() * 1000),
  }
}

/**
 * Enqueue a pipeline run with bounded concurrency.
 * If capacity available → execute immediately.
 * If at capacity → leave as 'pending' for queue polling to pick up.
 */
export async function enqueueRun(runId: number): Promise<'started' | 'queued'> {
  if (registerActiveRun(runId)) {
    executeWithLifecycle(runId).catch(() => {})
    return 'started'
  }

  await logAgent('pipeline-runtime', 'info',
    `Run #${runId} в очереди (${activeRuns.size}/${MAX_CONCURRENT_RUNS} слотов занято) [${INSTANCE_ID}]`,
    { runId, instanceId: INSTANCE_ID },
  )
  return 'queued'
}

/** Execute pipeline with full lifecycle: register → heartbeat → execute → deregister. */
async function executeWithLifecycle(runId: number): Promise<void> {
  const heartbeatTimer = setInterval(() => heartbeatRun(runId), HEARTBEAT_INTERVAL_MS)

  try {
    await executePipeline(runId)
  } finally {
    clearInterval(heartbeatTimer)
    deregisterActiveRun(runId)
    // Try to process next queued run
    processQueue().catch(() => {})
  }
}

/**
 * Финализирует pending runs, у которых был запрошен cancel.
 * Cancel endpoint для pending делает это сам (status='cancelled' inline,
 * см. cancel.post.ts), но если race condition или ручная вставка
 * cancelRequestedAt без обновления status — здесь мы безопасно подметаем.
 * Также покрывает retry-step → enqueueRun race: pending выставлен,
 * cancel пришёл до того, как processQueue клеймнул его в running.
 *
 * processQueue фильтрует `cancelRequestedAt: null` — без этого финализатора
 * pending run с cancelRequestedAt застревает навечно (баг B).
 */
export async function finalizeCancelledPending(): Promise<void> {
  const stuck = await prisma.workflowRun.findMany({
    where: {
      status: 'pending',
      cancelRequestedAt: { not: null },
    },
    select: { id: true, pipelineId: true },
    take: 50,
  })

  if (stuck.length === 0) return

  for (const run of stuck) {
    // Atomic: переводим только если всё ещё pending — не отнимаем у параллельного claim
    const updated = await prisma.workflowRun.updateMany({
      where: { id: run.id, status: 'pending' },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        errorMessage: `Отменён до начала выполнения (queue sweeper, ${INSTANCE_ID})`,
        errorCategory: 'cancellation',
      },
    })

    if (updated.count > 0) {
      // Финализируем зомби-шаги (pending/running) — симметрично с recoverOrphanedRuns,
      // чтобы UI не показывал «висящие» шаги под cancelled run.
      await prisma.workflowStep.updateMany({
        where: {
          runId: run.id,
          status: { in: ['pending', 'running'] },
        },
        data: {
          status: 'cancelled',
          finishedAt: new Date(),
          error: 'Шаг отменён до начала выполнения (queue sweeper)',
          errorCategory: 'cancellation',
        },
      }).catch(() => {})

      await logAgent('pipeline-runtime', 'info',
        `Pending run #${run.id} конвейера #${run.pipelineId} финализирован как cancelled (sweeper) [${INSTANCE_ID}]`,
        { runId: run.id, pipelineId: run.pipelineId, instanceId: INSTANCE_ID },
      ).catch(() => {})
    }
  }
}

/**
 * Process pending runs from the queue (FIFO).
 * Uses atomic DB claim: only picks runs that are genuinely pending
 * and not already claimed by another concurrent request.
 */
async function processQueue(): Promise<void> {
  // Сначала подметаем pending с cancelRequestedAt: иначе ниже они застрянут
  // из-за фильтра `cancelRequestedAt: null`.
  await finalizeCancelledPending().catch(() => {})

  if (activeRuns.size >= MAX_CONCURRENT_RUNS) return

  const slotsAvailable = MAX_CONCURRENT_RUNS - activeRuns.size
  if (slotsAvailable <= 0) return

  const pendingRuns = await prisma.workflowRun.findMany({
    where: {
      status: 'pending',
      cancelRequestedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    take: slotsAvailable,
    select: { id: true },
  })

  for (const run of pendingRuns) {
    if (activeRuns.size >= MAX_CONCURRENT_RUNS) break
    if (activeRuns.has(run.id)) continue

    // Atomic claim: transition pending → running only if still pending
    const claimed = await prisma.workflowRun.updateMany({
      where: { id: run.id, status: 'pending' },
      data: { status: 'running', startedAt: new Date() },
    })

    if (claimed.count > 0 && registerActiveRun(run.id)) {
      executeWithLifecycle(run.id).catch(() => {})
    } else if (claimed.count > 0) {
      // Registered failed (at capacity) — revert to pending
      await prisma.workflowRun.updateMany({
        where: { id: run.id, status: 'running' },
        data: { status: 'pending' },
      }).catch(() => {})
    }
  }
}

/**
 * Recovery after process restart.
 * Finds runs that were 'running' but are no longer tracked in memory.
 * Marks old ones as failed, re-queues recent ones.
 */
export async function recoverOrphanedRuns(): Promise<number> {
  const orphanedRuns = await prisma.workflowRun.findMany({
    where: {
      status: 'running',
    },
    select: { id: true, pipelineId: true, startedAt: true, cancelRequestedAt: true },
  })

  let recovered = 0

  for (const run of orphanedRuns) {
    if (activeRuns.has(run.id)) continue

    const age = Date.now() - new Date(run.startedAt).getTime()

    // If cancellation was requested, mark as cancelled — never re-queue cancelled runs
    if (run.cancelRequestedAt) {
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: 'cancelled',
          finishedAt: new Date(),
          errorMessage: `Отменённый запуск завершён при восстановлении сервера (recovery by ${INSTANCE_ID})`,
          errorCategory: 'cancellation',
        },
      })
      await logAgent('pipeline-runtime', 'info',
        `Сиротский отменённый запуск #${run.id} (конвейер #${run.pipelineId}) завершён как cancelled [${INSTANCE_ID}]`,
        { runId: run.id, instanceId: INSTANCE_ID },
      )
    } else if (age > 60 * 60 * 1000) {
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorMessage: `Запуск потерян после перезагрузки сервера (recovery by ${INSTANCE_ID})`,
          errorCategory: 'runtime',
        },
      })
      await logAgent('pipeline-runtime', 'warn',
        `Сиротский запуск #${run.id} (конвейер #${run.pipelineId}) отмечен как failed (старше 1 часа) [${INSTANCE_ID}]`,
        { runId: run.id, instanceId: INSTANCE_ID },
      )
    } else {
      // Atomic: only reset to pending if still running (not claimed by another process)
      const reset = await prisma.workflowRun.updateMany({
        where: { id: run.id, status: 'running' },
        data: { status: 'pending' },
      })
      if (reset.count > 0) {
        // Финализируем зомби-шаги, прерванные крашем. Без этого они остаются
        // вечно в running/pending в UI и засоряют step log. Их статус failed
        // с категорией runtime отражает реальную природу прерывания, а engine
        // при resume пропустит их по completedNodeIds из success-шагов.
        const finalized = await prisma.workflowStep.updateMany({
          where: {
            runId: run.id,
            status: { in: ['running', 'pending'] },
          },
          data: {
            status: 'failed',
            errorCategory: 'runtime',
            error: 'Шаг прерван перезагрузкой сервера, run будет возобновлён с уже выполненных шагов',
            finishedAt: new Date(),
          },
        })
        await logAgent('pipeline-runtime', 'info',
          `Сиротский запуск #${run.id} возвращён в очередь, финализировано ${finalized.count} прерванных шагов [${INSTANCE_ID}]`,
          { runId: run.id, instanceId: INSTANCE_ID, finalizedSteps: finalized.count },
        )
      }
    }
    recovered++
  }

  return recovered
}

/** Detect runs with stale heartbeats (in-memory only). */
export function detectStaleHeartbeats(): number {
  const now = Date.now()
  let staleCount = 0

  for (const [runId, entry] of activeRuns) {
    if (now - entry.lastHeartbeat > HEARTBEAT_STALE_MS) {
      activeRuns.delete(runId)
      staleCount++
      prisma.workflowRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorMessage: `Heartbeat потерян — запуск зависший [${INSTANCE_ID}]`,
          errorCategory: 'timeout',
        },
      }).catch(() => {})
    }
  }

  return staleCount
}

/**
 * Start the queue polling loop.
 * Called once from scheduler plugin on startup.
 */
export function startQueuePolling(): () => void {
  if (queuePollingActive) return () => {}
  queuePollingActive = true

  // Один проход сразу при старте — подметает pending+cancelRequestedAt,
  // оставшиеся с прошлой жизни процесса (рестарт сервера). Не ждём первого тика.
  finalizeCancelledPending().catch(() => {})

  const timer = setInterval(async () => {
    try {
      await processQueue()
      detectStaleHeartbeats()
    } catch {
      // Silently continue
    }
  }, QUEUE_POLL_INTERVAL_MS)

  return () => {
    clearInterval(timer)
    queuePollingActive = false
  }
}
