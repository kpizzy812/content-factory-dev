/**
 * Разбор сортировки списков.
 *
 * Один модуль на все разделы: шапка таблицы во всём приложении отдаёт одну и
 * ту же строку вида `-createdAt`, и разбирать её в каждом endpoint заново
 * значит разъехаться в мелочах — где-то знак минуса, где-то отдельный
 * `sortOrder`, где-то молчаливый откат к дефолту.
 *
 * Принимаются оба вида записи: `sort=-views` и `sortBy=views&sortOrder=asc`.
 * Первый пишет интерфейс списков, второй остался у аналитики.
 *
 * Поле вне списка разрешённых молча падает на дефолт: адресную строку правят
 * руками, и опечатка не должна ронять запрос.
 */

export interface SortSpec {
  field: string
  direction: 'asc' | 'desc'
}

export interface ParseSortOptions {
  /** Поля, по которым сортировать можно. */
  allowed: readonly string[]
  /** Поле по умолчанию. Обязано входить в `allowed`. */
  defaultField: string
  /** Направление по умолчанию. */
  defaultDirection?: 'asc' | 'desc'
}

export function parseSort(
  query: Record<string, unknown>,
  options: ParseSortOptions,
): SortSpec {
  const allowed = new Set(options.allowed)
  const fallback: SortSpec = {
    field: options.defaultField,
    direction: options.defaultDirection ?? 'desc',
  }

  const raw = typeof query.sort === 'string' ? query.sort.trim() : ''
  if (raw) {
    const direction = raw.startsWith('-') ? 'desc' : 'asc'
    const field = raw.replace(/^-/, '')
    return allowed.has(field) ? { field, direction } : fallback
  }

  const sortBy = typeof query.sortBy === 'string' ? query.sortBy.trim() : ''
  if (sortBy && allowed.has(sortBy)) {
    const order = String(query.sortOrder ?? '').trim().toLowerCase()
    return { field: sortBy, direction: order === 'asc' ? 'asc' : 'desc' }
  }

  return fallback
}

/**
 * `orderBy` для Prisma.
 *
 * У полей из `nullsLast` пустое значение уходит в конец в обе стороны: ролик
 * без стоимости и тренд без виральности не должны возглавлять список только
 * потому, что величины у них нет.
 */
export function toOrderBy(
  spec: SortSpec,
  nullsLast: readonly string[] = [],
): Record<string, unknown> {
  if (nullsLast.includes(spec.field)) {
    return { [spec.field]: { sort: spec.direction, nulls: 'last' } }
  }
  return { [spec.field]: spec.direction }
}
