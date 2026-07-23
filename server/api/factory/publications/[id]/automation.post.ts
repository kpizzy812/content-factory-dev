import { syncFactoryPublicationAutomation } from '../../../../utils/factory-automation'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')?.trim()
  if (!id) throw createError({ statusCode: 400, message: 'Publication ID is required' })

  const publication = await prisma.factoryPublication.findUnique({
    where: { id },
    select: {
      id: true,
      appId: true,
      socialAccount: {
        select: { displayName: true },
      },
    },
  })
  if (!publication) throw createError({ statusCode: 404, message: 'Factory publication not found' })

  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
    appId: publication.appId,
    accountName: publication.socialAccount.displayName,
  })

  try {
    const result = await syncFactoryPublicationAutomation(id)
    return { data: result }
  } catch (error) {
    throw createError({
      statusCode: 409,
      message: error instanceof Error ? error.message : 'Factory automation sync failed',
    })
  }
})
