/**
 * Форматирование метрик публикаций.
 *
 * `watchThrough` и `ctr` хранятся долей (0…1) — так их и отдают платформы, и
 * так они называются: доля досмотра, click-through *rate*. Интерфейс до этого
 * дописывал к доле знак процента, и 0.703 превращалось в «0.703%» вместо
 * «70,3%» — на пустой базе этого не было видно.
 */

/** Доля 0…1 → «70,3 %». null и мусор дают прочерк. */
export function formatRate(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  // Значения больше единицы приходить не должны, но если пришли — не врём и
  // показываем как есть: лучше странное число, чем молча делённое на сто.
  const percent = value <= 1 ? value * 100 : value
  return `${percent.toFixed(digits).replace('.', ',')} %`
}

/** Крупные счётчики: «444,5 тыс.» вместо «444532». */
export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < 10_000) return String(Math.round(value))
  if (Math.abs(value) < 1_000_000) return `${(value / 1000).toFixed(1).replace('.', ',')} тыс.`
  return `${(value / 1_000_000).toFixed(1).replace('.', ',')} млн`
}
