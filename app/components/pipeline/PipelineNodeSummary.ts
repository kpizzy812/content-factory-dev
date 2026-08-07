/**
 * Краткое содержание настроек блока для карточки на канвасе.
 *
 * В макете под именем блока стоит строка вида «TikTok, RU, 50 шт». Сочинять её
 * по типу блока нельзя — она должна показывать то, что оператор действительно
 * настроил, поэтому берётся из его собственного `config`.
 *
 * Правила простые: только заполненные значения, только примитивы и короткие
 * списки, не больше трёх — строка шириной в 160 пикселей и длинный хвост в ней
 * всё равно не читается.
 */

const MAX_VALUES = 3
const MAX_LENGTH = 40

/** Служебные ключи, которые ничего не говорят оператору. */
const SKIP_KEYS = new Set(['id', 'nodeId', 'label', 'notes', 'description'])

function stringify(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value ? 'да' : null
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    const items = value.map(stringify).filter(Boolean)
    if (items.length === 0) return null
    return items.length <= 2 ? items.join(', ') : `${items.length} шт`
  }
  return null
}

export function nodeConfigSummary(config: Record<string, unknown> | undefined | null): string | null {
  if (!config || typeof config !== 'object') return null

  const parts: string[] = []
  for (const [key, value] of Object.entries(config)) {
    if (SKIP_KEYS.has(key)) continue
    const text = stringify(value)
    if (!text) continue
    parts.push(text)
    if (parts.length >= MAX_VALUES) break
  }

  if (parts.length === 0) return null
  const summary = parts.join(', ')
  return summary.length > MAX_LENGTH ? `${summary.slice(0, MAX_LENGTH - 1)}…` : summary
}
