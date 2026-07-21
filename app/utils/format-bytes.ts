/**
 * Форматирование размера файла в человекочитаемом виде.
 * 1024-base (KB/MB/GB), unicode non-breaking space между числом и единицей.
 */
export function formatBytes(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const num = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(num) || num < 0) return '—'
  if (num < 1024) return `${num} Б`
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ']
  let n = num / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const formatted = n >= 100 ? n.toFixed(0) : n.toFixed(1)
  return `${formatted} ${units[i]}`
}
