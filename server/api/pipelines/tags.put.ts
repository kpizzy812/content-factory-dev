export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{ oldName?: string; newName?: string }>(event)

  if (!body?.oldName || !body?.newName || !body.oldName.trim() || !body.newName.trim()) {
    throw createError({ statusCode: 400, message: 'oldName и newName обязательны' })
  }

  const oldName = body.oldName.trim()
  const newName = body.newName.trim()

  if (oldName === newName) return { data: { name: newName } }

  const existing = await prisma.pipelineTag.findUnique({
    where: { name: oldName },
  })

  if (!existing) {
    throw createError({ statusCode: 404, message: 'Тег не найден' })
  }

  const tag = await prisma.pipelineTag.update({
    where: { name: oldName },
    data: { name: newName },
    select: { id: true, name: true },
  })

  return { data: tag }
})
