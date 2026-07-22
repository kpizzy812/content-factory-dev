export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appId = Number(query.appId)
  if (!Number.isInteger(appId) || appId <= 0) {
    throw createError({ statusCode: 400, message: 'appId is required' })
  }
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
    appId,
  })

  const items = await prisma.contentFunnel.findMany({
    where: {
      appId,
      ...(query.status ? { status: String(query.status) } : {}),
    },
    select: {
      id: true,
      appId: true,
      leadMagnetId: true,
      name: true,
      keyword: true,
      deliveryAdapter: true,
      deliveryConfig: true,
      automationAdapter: true,
      automationConfig: true,
      conversionAdapter: true,
      conversionUrl: true,
      conversionTrackingParam: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      leadMagnet: {
        select: { id: true, title: true, status: true },
      },
      _count: {
        select: { cycles: true, publications: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return { data: items }
})