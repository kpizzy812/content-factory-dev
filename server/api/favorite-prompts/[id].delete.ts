/**
 * DELETE /api/favorite-prompts/:id — удаление избранного промта.
 * Только автор или admin.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canDelete'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID' })
  }

  const existing = await prisma.favoritePrompt.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Промт не найден' })
  }

  if (existing.userId !== user.id && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Удалять может только автор или администратор' })
  }

  await prisma.favoritePrompt.delete({ where: { id } })

  return { data: { id }, meta: { deleted: true } }
})
