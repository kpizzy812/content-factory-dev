export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'script-generator' })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const scenario = await prisma.scenario.findUnique({
    where: { id },
    include: {
      trend: {
        include: {
          insights: true,
          brief: true,
          app: true,
        },
      },
      variants: {
        where: { isDeleted: false },
        orderBy: { variantIndex: 'asc' },
        include: {
          visualStyleRevisions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      reviewActions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      // Scene включён для shadow Scenario (trendId=null + sceneId!=null).
      // UI на /scenarios/[id] показывает info-баннер со ссылкой на сцену.
      scene: { select: { id: true, name: true } },
    },
  })

  if (!scenario) {
    throw createError({ statusCode: 404, message: 'Сценарий не найден' })
  }

  return { data: scenario }
})
