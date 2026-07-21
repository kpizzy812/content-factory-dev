/**
 * Shared formatting functions for pipeline preview surfaces.
 * Single source — no more duplicated formatters across components.
 */

/** Format duration from milliseconds */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return '--'
  if (ms < 1000) return `${ms}мс`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}с`
  return `${(ms / 60000).toFixed(1)}мин`
}

/** Format duration from start/end date strings */
export function formatDurationRange(start: string | null, end: string | null): string {
  if (!start || !end) return '--'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return formatDurationMs(ms)
}

/** Relative time: "3 мин назад", "2 ч назад", etc. */
export function formatRelativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'только что'
  if (mins < 60) return `${mins} мин назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн назад`
  return formatDateShort(date)
}

/** Short date: 16.04.26, 14:32 */
export function formatDateShort(date: string): string {
  return new Date(date).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Full date: 16 апреля 2026, 14:32 */
export function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Date only: 16 апр. 2026 */
export function formatDateOnly(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Safe JSON.stringify for input/output preview */
export function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '--'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
