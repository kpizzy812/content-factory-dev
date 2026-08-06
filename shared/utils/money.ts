/**
 * Деньги в интерфейсе.
 *
 * Весь учёт завода в долларах: `ServiceBalanceEntry.currency` по умолчанию USD,
 * `AiAuditLog.costUsd`, `Video.totalCostActual` и `WorkflowStep.costActual`
 * приходят из счетов провайдеров (Replicate, fal.ai, Anthropic, Mubert).
 * Поэтому знак валюты один и тот же везде, а не свой на каждом экране.
 *
 * Форматируем руками, а не через `Intl.NumberFormat`: сервер и браузер могут
 * разойтись в пробеле-разделителе, и Vue бросит поддерево при гидратации.
 */

const NBSP = ' '

/** Разряды пробелом, дробная часть запятой — как в макетах. */
function groupDigits(value: number, fractionDigits: number): string {
  const fixed = Math.abs(value).toFixed(fractionDigits)
  const [whole = '0', fraction] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  const sign = value < 0 ? '−' : ''
  return fraction ? `${sign}${grouped},${fraction}` : `${sign}${grouped}`
}

/**
 * Сумма со знаком валюты: `241,60 $`.
 *
 * Копейки скрываются у сумм от тысячи: на счёте завода они не читаются, а
 * ширину колонки съедают.
 */
export function formatMoney(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null
  const fractionDigits = Math.abs(value) >= 1000 ? 0 : 2
  return `${groupDigits(value, fractionDigits)}${NBSP}$`
}

/**
 * Сумма для плотных мест — карточка списка, строка лога: без копеек у крупных,
 * с двумя знаками у мелких, но всегда со знаком валюты.
 *
 * Отдельная функция, а не флаг: места, где сумма может отсутствовать, обязаны
 * различать «ноль» и «неизвестно», и это видно по типу возврата.
 */
export function formatMoneyOrDash(value: number | null | undefined): string {
  return formatMoney(value) ?? '—'
}
