export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{ name?: string }>(event)

  if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({ statusCode: 400, message: 'Название тега обязательно' })
  }

  const name = body.name.trim()

  const existing = await prisma.pipelineTag.findUnique({
    where: { name },
  })

  if (existing) {
    throw createError({ statusCode: 409, message: 'Тег уже существует' })
  }

  const tag = await prisma.pipelineTag.create({
    data: { name },
    select: { id: true, name: true },
  })

  return { data: tag }
})
