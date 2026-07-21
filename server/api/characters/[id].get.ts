/**
 * GET /api/characters/:id — детальная карточка персонажа со всеми референсами.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const character = await prisma.character.findUnique({
    where: { id },
    include: {
      referenceImages: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      },
    },
  })
  if (!character) {
    throw createError({ statusCode: 404, message: "Персонаж не найден" })
  }

  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "script-generator",
    appId: character.appId,
  })

  return { data: character }
})
