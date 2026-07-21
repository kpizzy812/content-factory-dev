/**
 * Pipeline Cancellation Registry.
 *
 * Централизованный реестр AbortController для active pipeline runs.
 * Используется engine при запуске run и cancel API для немедленной терминации.
 *
 * Архитектура:
 * - Engine создаёт AbortController при старте run через `createRunSignal(runId)`
 * - Cancel API вызывает `abortRun(runId)` — немедленно abort'ит controller
 * - Все executors получают AbortSignal и проверяют его в polling/wait loops
 * - При завершении run engine вызывает `cleanupRunSignal(runId)`
 */

/** Active run AbortControllers keyed by runId */
const runControllers = new Map<number, AbortController>()

/**
 * Создать AbortController для запуска pipeline.
 * Вызывается из engine при старте executePipeline().
 */
export function createRunSignal(runId: number): AbortSignal {
  // Если уже есть — abort старый (защита от дублей)
  const existing = runControllers.get(runId)
  if (existing) existing.abort()

  const controller = new AbortController()
  runControllers.set(runId, controller)
  return controller.signal
}

/**
 * Немедленно прервать запуск pipeline.
 * Вызывается из cancel API endpoint.
 * Возвращает true если controller существовал и был abort'нут.
 */
export function abortRun(runId: number): boolean {
  const controller = runControllers.get(runId)
  if (!controller) return false
  controller.abort()
  return true
}

/**
 * Проверить, запрошена ли отмена (через signal, без DB query).
 */
export function isRunAborted(runId: number): boolean {
  const controller = runControllers.get(runId)
  return controller?.signal.aborted ?? false
}

/**
 * Получить signal для run (если существует).
 */
export function getRunSignal(runId: number): AbortSignal | undefined {
  return runControllers.get(runId)?.signal
}

/**
 * Очистить controller после завершения run.
 */
export function cleanupRunSignal(runId: number): void {
  runControllers.delete(runId)
}

/**
 * Утилита: создать cancellable delay.
 * Резолвится через ms миллисекунд, или reject'ится если signal aborted.
 */
export function cancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new CancellationError())

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      reject(new CancellationError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Утилита: проверить signal и выбросить CancellationError если aborted.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancellationError()
}

/**
 * Специальный тип ошибки для отмены — легко отличить от runtime errors.
 */
export class CancellationError extends Error {
  constructor(message = 'Выполнение отменено') {
    super(message)
    this.name = 'CancellationError'
  }
}
