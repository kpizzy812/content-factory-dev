/**
 * GET /api/saved-views?section=trends — представления раздела.
 *
 * Отдаёт общие представления команды и личные текущего пользователя.
 * Системные («Все», «Новые за 24 часа») заводятся на клиенте и сюда не попадают:
 * их нельзя ни удалить, ни переименовать, поэтому в БД им делать нечего.
 */
import { normalizeSection, toDto } from "../../utils/saved-views"

export default defineEventHandler(async (event) => {
  const user = await requirePermission(event, "canRead")
  const section = normalizeSection(getQuery(event).section)

  const rows = await prisma.savedView.findMany({
    where: {
      section,
      OR: [{ scope: "shared" }, { scope: "personal", ownerId: user.id }],
    },
    include: { owner: { select: { name: true, surname: true, email: true } } },
    // Общие идут первыми — это процесс команды, личные ниже.
    orderBy: [{ scope: "asc" }, { name: "asc" }],
  })

  return { data: rows.map(toDto) }
})
