/**
 * Общие валидаторы для warmup endpoints.
 *
 * Используется в server/api/warmup/keywords/*.ts (POST, PUT) и других местах,
 * где нужно нормализовать входной массив строк.
 */

/**
 * Приводит unknown к массиву уникальных непустых строк.
 * - Не-массив → 400.
 * - Не-строки внутри массива → пропускаются.
 * - Дубликаты схлопываются.
 *
 * @param raw — значение из тела запроса
 * @param field — имя поля для сообщения об ошибке
 */
export function asStringArray(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) {
    throw createError({ statusCode: 400, message: `Поле '${field}' должно быть массивом строк` })
  }
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== "string") continue
    const v = item.trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}
