/**
 * POST /api/saved-views — создать представление.
 *
 * Личное создаётся любым, кто может читать раздел: это его личный инструмент,
 * последствий для команды нет. Общее — только при праве на общие представления.
 */
import type { SavedViewInput } from "../../../shared/types/saved-view"
import { SAVED_VIEW_MAX_PER_USER } from "../../../shared/types/saved-view"
import {
  canManageSharedViews,
  normalizeColumns,
  normalizeName,
  normalizeQuery,
  normalizeScope,
  normalizeSection,
  toDto,
} from "../../utils/saved-views"

export default defineEventHandler(async (event) => {
  const user = await requirePermission(event, "canRead")
  const body = await readBody<SavedViewInput>(event)

  const section = normalizeSection(body?.section)
  const name = normalizeName(body?.name)
  const scope = normalizeScope(body?.scope)
  const query = normalizeQuery(body?.query)
  const columns = normalizeColumns(body?.columns)

  if (scope === "shared" && !canManageSharedViews(user)) {
    throw createError({ statusCode: 403, message: "Нет права создавать общие представления" })
  }

  if (scope === "personal") {
    const count = await prisma.savedView.count({
      where: { ownerId: user.id, scope: "personal" },
    })
    if (count >= SAVED_VIEW_MAX_PER_USER) {
      throw createError({
        statusCode: 400,
        message: `Больше ${SAVED_VIEW_MAX_PER_USER} личных представлений хранить нельзя — удалите ненужные`,
      })
    }
  }

  const created = await prisma.savedView.create({
    data: { section, name, scope, query, columns: columns ?? undefined, ownerId: user.id },
    include: { owner: { select: { name: true, surname: true, email: true } } },
  })

  setResponseStatus(event, 201)
  return { data: toDto(created) }
})
