/**
 * Telegram alert deduplication для прокси-алёртов.
 *
 * Без дедупликации scheduler с 4-часовым интервалом отправит 6 алёртов в сутки
 * на одну битую прокси — оператор отключит уведомления и пропустит реальные проблемы.
 *
 * История хранится в Proxy.alertHistory (JSON):
 *   { [reason]: { lastAt: ISO-string, count: number } }
 *
 * Quiet period подобран так, чтобы критичные проблемы (leak/dead) повторялись
 * не чаще раза в сутки, expired — раз в неделю.
 */

export type AlertReason =
  | "leak"
  | "consecutive_failures_3"
  | "auth_failed"
  | "expired"

export interface AlertHistoryEntry {
  lastAt: string
  count: number
}

export type AlertHistory = Record<string, AlertHistoryEntry>

const QUIET_PERIODS_MS: Record<AlertReason, number> = {
  leak: 24 * 60 * 60 * 1000,
  consecutive_failures_3: 24 * 60 * 60 * 1000,
  auth_failed: 12 * 60 * 60 * 1000,
  expired: 7 * 24 * 60 * 60 * 1000,
}

function parseHistory(value: unknown): AlertHistory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as AlertHistory
}

/**
 * Возвращает true если этот reason можно отправлять (вышли из quiet period
 * или категория проблемы ранее не встречалась).
 */
export function shouldSendAlert(
  history: unknown,
  reason: AlertReason,
): boolean {
  const parsed = parseHistory(history)
  if (!parsed) return true
  const last = parsed[reason]
  if (!last) return true
  const elapsedMs = Date.now() - new Date(last.lastAt).getTime()
  if (Number.isNaN(elapsedMs)) return true
  return elapsedMs >= QUIET_PERIODS_MS[reason]
}

/**
 * Возвращает обновлённую копию истории с зафиксированным алёртом.
 * Не мутирует исходный объект — результат сразу пригоден для prisma.update().
 */
export function recordAlert(
  history: unknown,
  reason: AlertReason,
): AlertHistory {
  const updated: AlertHistory = { ...(parseHistory(history) ?? {}) }
  const prev = updated[reason]
  updated[reason] = {
    lastAt: new Date().toISOString(),
    count: (prev?.count ?? 0) + 1,
  }
  return updated
}

/**
 * Сколько миллисекунд до следующего разрешённого алёрта по этому reason.
 * 0 — можно отправлять прямо сейчас. null — алёрта по этой категории не было.
 */
export function msUntilNextAlert(
  history: unknown,
  reason: AlertReason,
): number | null {
  const parsed = parseHistory(history)
  if (!parsed) return null
  const last = parsed[reason]
  if (!last) return null
  const elapsedMs = Date.now() - new Date(last.lastAt).getTime()
  if (Number.isNaN(elapsedMs)) return null
  const remaining = QUIET_PERIODS_MS[reason] - elapsedMs
  return Math.max(0, remaining)
}

/**
 * Полный snapshot истории + сколько ждать. Используется UI для tooltip.
 */
export interface AlertHistorySummary {
  reason: AlertReason
  lastAt: string
  count: number
  nextAllowedInMs: number
}

export function summarizeAlertHistory(
  history: unknown,
): AlertHistorySummary[] {
  const parsed = parseHistory(history)
  if (!parsed) return []
  const reasons: AlertReason[] = [
    "leak",
    "consecutive_failures_3",
    "auth_failed",
    "expired",
  ]
  const result: AlertHistorySummary[] = []
  for (const reason of reasons) {
    const entry = parsed[reason]
    if (!entry) continue
    const elapsedMs = Date.now() - new Date(entry.lastAt).getTime()
    const remaining = Number.isNaN(elapsedMs)
      ? 0
      : Math.max(0, QUIET_PERIODS_MS[reason] - elapsedMs)
    result.push({
      reason,
      lastAt: entry.lastAt,
      count: entry.count,
      nextAllowedInMs: remaining,
    })
  }
  return result
}
