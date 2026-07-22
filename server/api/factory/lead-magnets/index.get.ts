export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appId = Number(query.appId)
  if (!Number.isInteger(appId) || appId <= 0) {
    throw createError({ statusCode: 400, message: 'appId обязателен' })
  }
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
    appId,
  })

  const items = await prisma.leadMagnet.findMany({
    where: {
      appId,
      ...(query.status ? { status: String(query.status) } : {}),
    },
    include: {
      _count: { select: { funnels: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return { data: items }
})
