export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const tags = await prisma.pipelineTag.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  return { data: tags }
})
