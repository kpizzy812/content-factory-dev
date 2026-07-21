/**
 * DELETE /api/taxonomy/:id
 *
 * Удалить (архивировать) taxonomy item. Системные элементы архивируются, пользовательские удаляются.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canDelete'],
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

  if (existing.createdById !== user.id && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Только создатель может удалять' })
  }

  // Системные — архивируем, пользовательские — удаляем
  if (existing.isSystem) {
    const updated = await prisma.taxonomyItem.update({
      where: { id },
      data: { isArchived: true },
    })
    return { data: updated, meta: { archived: true } }
  }

  await prisma.taxonomyItem.delete({ where: { id } })
  return { data: { id }, meta: { deleted: true } }
})
