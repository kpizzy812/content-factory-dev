/**
 * GET /api/accounts/:id/style
 * Возвращает style profile аккаунта (resolved с учётом group policy).
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'social-upload' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID аккаунта' })
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!account) {
    throw createError({ statusCode: 404, message: 'Аккаунт не найден' })
  }

  const resolved = await getAccountStyleContext(id)

  // Загрузить историю ревизий если есть профиль
  let revisions: unknown[] = []
  if (resolved.profileId) {
    revisions = await prisma.accountStyleRevision.findMany({
      where: { profileId: resolved.profileId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
  }

  return {
    data: {
      ...resolved,
      revisions,
    },
  }
})
