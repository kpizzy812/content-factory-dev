/**
 * GET /api/favorite-prompts/:id — детальный избранный промт.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID' })
  }

  const item = await prisma.favoritePrompt.findUnique({
    where: { id },
    include: {
      app: { select: { id: true, name: true } },
      sourceVideoAsset: {
        select: {
          id: true,
          order: true,
          video: { select: { id: true, scenarioId: true } },
        },
      },
    },
  })

  if (!item) {
    throw createError({ statusCode: 404, message: 'Промт не найден' })
  }

  // Видимость: публичные всем либо собственная запись
  const isOwner = item.userId === user.id
  if (!item.isPublic && !isOwner && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Нет доступа к этому промту' })
  }

  // RBAC по appAssignments: не-admin может смотреть только те промты, у которых либо
  // appId IS NULL (универсальный), либо есть UserAppAssignment с accessLevel != 'none'.
  if (!user.canAdmin && item.appId !== null) {
    const assignment = user.appAssignments.find((a) => a.appId === item.appId)
    if (!assignment || assignment.accessLevel === "none") {
      throw createError({ statusCode: 403, message: 'Нет доступа к приложению этого промта' })
    }
  }

  return { data: item }
})
