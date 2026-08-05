import type { H3Event } from "h3"
import type { SavedViewDto } from "../../shared/types/saved-view"
import { SAVED_VIEW_NAME_MAX } from "../../shared/types/saved-view"

/**
 * Право на правку общих представлений.
 *
 * По дизайну это отдельное право `canManageSharedViews`, но реальные флаги
 * пользователя приходят из MarketingCamp при логине (см. server/utils/rbac-presets.ts),
 * и девятый флаг оттуда не придёт — колонка навсегда осталась бы в значении по
 * умолчанию, то есть общие представления не смог бы вести никто.
 *
 * Поэтому пока гейт — `canAdmin`. Проверка живёт в одном месте: когда MC научится
 * отдавать отдельный флаг, меняется только эта функция.
 */
export function canManageSharedViews(user: { canAdmin?: boolean } | null | undefined): boolean {
  return user?.canAdmin === true
}

/** Раздел списка: только латиница и дефис, чтобы не плодить мусорные ключи. */
export function normalizeSection(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(value)) {
    throw createError({ statusCode: 400, message: "Некорректный раздел представления" })
  }
  return value
}

export function normalizeName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : ""
  if (!value) {
    throw createError({ statusCode: 400, message: "Название представления обязательно" })
  }
  return value.slice(0, SAVED_VIEW_NAME_MAX)
}

export function normalizeScope(raw: unknown): "shared" | "personal" {
  return raw === "shared" ? "shared" : "personal"
}

/**
 * Параметры фильтра. Пишем как есть, но без вложенных объектов и функций:
 * представление должно оставаться плоским набором значений формы.
 */
export function normalizeQuery(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw createError({ statusCode: 400, message: "Параметры представления обязательны" })
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || value === undefined || value === "") continue
    const t = typeof value
    if (t === "string" || t === "number" || t === "boolean") out[key] = value
    else if (Array.isArray(value) && value.every(v => typeof v === "string")) out[key] = value
  }
  return out
}

export function normalizeColumns(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null
  if (!Array.isArray(raw)) return null
  return raw.filter((c): c is string => typeof c === "string").slice(0, 40)
}

type SavedViewRow = {
  id: number
  section: string
  name: string
  scope: string
  query: unknown
  columns: unknown
  ownerId: number | null
  updatedAt: Date
  owner?: { name: string | null, surname: string | null, email: string } | null
}

export function toDto(row: SavedViewRow): SavedViewDto {
  const owner = row.owner
  const ownerName = owner
    ? [owner.name, owner.surname].filter(Boolean).join(" ") || owner.email
    : null

  return {
    id: row.id,
    section: row.section,
    name: row.name,
    scope: row.scope === "shared" ? "shared" : "personal",
    query: (row.query ?? {}) as Record<string, unknown>,
    columns: Array.isArray(row.columns) ? (row.columns as string[]) : null,
    ownerId: row.ownerId,
    ownerName,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Загружает представление и проверяет, что текущий пользователь может его менять. */
export async function loadEditableView(
  event: H3Event,
  id: number,
  user: { id: number, canAdmin?: boolean },
) {
  const view = await prisma.savedView.findUnique({ where: { id } })
  if (!view) {
    throw createError({ statusCode: 404, message: "Представление не найдено" })
  }
  if (view.scope === "shared") {
    if (!canManageSharedViews(user)) {
      throw createError({ statusCode: 403, message: "Нет права менять общие представления" })
    }
  }
  else if (view.ownerId !== user.id) {
    throw createError({ statusCode: 403, message: "Это чужое личное представление" })
  }
  return view
}
