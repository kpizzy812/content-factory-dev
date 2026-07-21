/**
 * PUT /api/taxonomy/:id
 *
 * Обновить taxonomy item. Системные элементы нельзя удалять, но можно редактировать описание.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Невалидный ID' })
  }

  const existing = await prisma.taxonomyItem.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Элемент не найден' })
  }

  // Только владелец или админ
  if (existing.createdById !== user.id && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Только создатель может редактировать' })
  }

  const body = await readBody<{
    name?: string
    shortDescription?: string
    fullExplanation?: string
    category?: string
    tags?: string[]
    examples?: string[]
    useCases?: string[]
    isArchived?: boolean
  }>(event)

  const data: Record<string, unknown> = {}

  if (body.name?.trim()) data.name = body.name.trim()
  if (body.shortDescription?.trim()) data.shortDescription = body.shortDescription.trim()
  if (body.fullExplanation !== undefined) data.fullExplanation = body.fullExplanation?.trim() || null
  if (body.category !== undefined) data.category = body.category?.trim() || null
  if (body.tags) data.tags = body.tags.map(t => t.trim().toLowerCase()).filter(Boolean)
  if (body.examples) data.examples = body.examples.filter(Boolean)
  if (body.useCases) data.useCases = body.useCases.filter(Boolean)
  if (typeof body.isArchived === 'boolean') data.isArchived = body.isArchived

  if (Object.keys(data).length === 0) {
    throw createError({ statusCode: 400, message: 'Нет полей для обновления' })
  }

  const updated = await prisma.taxonomyItem.update({
    where: { id },
    data,
  })

  return { data: updated }
})
