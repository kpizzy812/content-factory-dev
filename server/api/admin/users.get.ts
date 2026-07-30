/**
 * GET /api/admin/users
 * Список пользователей с пагинацией и фильтрами.
 */
import { PUBLIC_USER_SELECT } from "~~/server/utils/auth/user-select"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20))
  const offset = (page - 1) * limit

  const where: Record<string, unknown> = {}

  if (query.rolePreset && typeof query.rolePreset === "string") {
    where.rolePreset = query.rolePreset
  }
  if (query.isActive !== undefined) {
    where.isActive = query.isActive === "true"
  }

  const [users, total] = await Promise.all([
    prisma.zavodUser.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: PUBLIC_USER_SELECT,
    }),
    prisma.zavodUser.count({ where }),
  ])

  return {
    data: users,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
})
