/** DELETE /api/saved-views/:id — удалить представление. */
import { loadEditableView } from "../../utils/saved-views"

export default defineEventHandler(async (event) => {
  const user = await requirePermission(event, "canRead")
  const id = Number(getRouterParam(event, "id"))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный идентификатор" })
  }

  await loadEditableView(event, id, user)
  await prisma.savedView.delete({ where: { id } })

  return { data: { id } }
})
