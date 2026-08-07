/**
 * Трактовка результата fal-preflight (falProbeAccess / falProbeAccessBatch).
 *
 * Останавливать запуск можно только на однозначных вердиктах: ключа нет
 * (no_api_key) или доступ к модели закрыт планом/воркспейсом (blocked_by_access).
 * probe_error — это сбой самой проверки (HTTP 5xx, таймаут, неизвестный код), а
 * не приговор модели: ронять из-за него весь прогон нельзя, реальный submit
 * вернёт внятную ошибку сам и без задержки на polling.
 */

const BLOCKING_STATUSES: ReadonlySet<string> = new Set(["no_api_key", "blocked_by_access"])

/** true — доступа точно нет, запуск останавливаем. */
export function isFalAccessBlocking(status: string | null | undefined): boolean {
  return typeof status === "string" && BLOCKING_STATUSES.has(status)
}

/** true — проверка не дала вердикта: продолжаем, но пишем предупреждение в лог. */
export function isFalProbeInconclusive(status: string | null | undefined): boolean {
  return typeof status === "string" && status !== "available" && !BLOCKING_STATUSES.has(status)
}
