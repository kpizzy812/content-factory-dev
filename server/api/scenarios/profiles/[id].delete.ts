/**
 * DELETE /api/scenarios/profiles/:id
 * Удаление профиля генерации сценариев.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canDelete'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID профиля',
    })
  }

  const existing = await prisma.scenarioGenerationProfile.findUnique({ where: { id } })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Профиль генерации не найден',
    })
  }

  await prisma.scenarioGenerationProfile.delete({ where: { id } })

  return { success: true }
})
