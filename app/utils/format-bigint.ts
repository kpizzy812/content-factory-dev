/**
 * Форматирование BigInt-строк (followers, views, и пр.) для display.
 *
 * Серверный DTO возвращает BigInt-поля как string (JSON.stringify не умеет BigInt).
 * Здесь парсим string → number для отображения. Для display точность float
 * достаточна — мы показываем "1.2K", "5.4M" а не точное число.
 *
 * formatNumber переиспользуется из app/utils/format.ts (auto-import).
 */
export function formatBigInt(value: string | null): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return formatNumber(n)
}

/**
 * Форматирование engagementRate (0..1) → "12.34%". null → "—".
 */
export function formatEngagementRate(rate: number | null): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—"
  return `${(rate * 100).toFixed(2)}%`
}

/**
 * Форматирование ISO-таймстампа в "21 мая, 19:30" (локаль ru-RU).
 */
export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}
