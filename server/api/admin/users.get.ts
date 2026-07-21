/**
 * GET /api/admin/users
 * Список пользователей с пагинацией и фильтрами.
 */
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
    }),
    prisma.zavodUser.count({ where }),
  ])

  return {
    data: users,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
})
