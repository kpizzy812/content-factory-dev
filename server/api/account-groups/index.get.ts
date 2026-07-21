/**
 * GET /api/account-groups
 * Список пачек аккаунтов с фильтром по appId/platform.
 * Включает dispatchMode и количество активных members (activeMembersCount).
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'social-upload' })

  const query = getQuery(event)
  const where: Record<string, unknown> = {}

  if (query.appId) {
    const appId = Number(query.appId)
    if (!Number.isNaN(appId) && appId > 0) {
      where.appId = appId
    }
  }

  const groups = await prisma.accountGroup.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      app: { select: { id: true, name: true } },
      members: {
        include: {
          socialAccount: {
            select: {
              id: true,
              platform: true,
              displayName: true,
              status: true,
              lastPostedAt: true,
            },
          },
        },
      },
    },
  })

  // Опциональный фильтр по platform — оставляем только группы, где есть хотя бы один аккаунт нужной платформы
  let filtered = groups
  if (query.platform && typeof query.platform === "string") {
    const validPlatforms = ["youtube", "tiktok", "instagram"]
    if (validPlatforms.includes(query.platform)) {
      filtered = groups.filter((g) =>
        g.members.some((m) => m.socialAccount.platform === query.platform),
      )
    }
  }

  const data = filtered.map((g) => ({
    ...g,
    activeMembersCount: g.members.filter((m) => m.socialAccount.status === "active").length,
  }))

  return { data }
})
