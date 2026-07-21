export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canDelete'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID идеи',
    })
  }

  const existing = await prisma.idea.findUnique({ where: { id } })

  if (!existing || existing.isDeleted) {
    throw createError({
      statusCode: 404,
      message: 'Идея не найдена',
    })
  }

  await prisma.$transaction([
    prisma.idea.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    }),
    prisma.ideaOperatorAction.create({
      data: {
        ideaId: id,
        actionType: 'delete',
        actorId: user.id,
      },
    }),
  ])

  return { data: { id }, meta: { deleted: true } }
})
