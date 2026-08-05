/**
 * PUT /api/saved-views/:id — обновить представление.
 *
 * Обычный пользователь общее представление не правит: он открывает его, крутит
 * фильтры и сохраняет копию себе. Поэтому 403 здесь — штатный ответ, а не ошибка.
 */
import type { SavedViewInput } from "../../../shared/types/saved-view"
import {
  loadEditableView,
  normalizeColumns,
  normalizeName,
  normalizeQuery,
  toDto,
} from "../../utils/saved-views"

export default defineEventHandler(async (event) => {
  const user = await requirePermission(event, "canRead")
  const id = Number(getRouterParam(event, "id"))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный идентификатор" })
  }

  await loadEditableView(event, id, user)

  const body = await readBody<Partial<SavedViewInput>>(event)
  const data: Record<string, unknown> = {}

  if (body?.name !== undefined) data.name = normalizeName(body.name)
  if (body?.query !== undefined) data.query = normalizeQuery(body.query)
  if (body?.columns !== undefined) data.columns = normalizeColumns(body.columns)

  if (!Object.keys(data).length) {
    throw createError({ statusCode: 400, message: "Нечего обновлять" })
  }

  const updated = await prisma.savedView.update({
    where: { id },
    data,
    include: { owner: { select: { name: true, surname: true, email: true } } },
  })

  return { data: toDto(updated) }
})
