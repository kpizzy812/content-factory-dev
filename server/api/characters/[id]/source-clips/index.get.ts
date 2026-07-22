export default defineEventHandler(async (event) => {
  const characterId = getRouterParam(event, "id")
  if (!characterId) throw createError({ statusCode: 400, message: "id обязателен" })

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, appId: true },
  })
  if (!character) throw createError({ statusCode: 404, message: "Персонаж не найден" })

  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "script-generator",
    appId: character.appId,
  })

  const query = getQuery(event)
  const includeInactive = query.includeInactive === "true"
  const clips = await prisma.presenterSourceClip.findMany({
    where: {
      characterId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [
      { isActive: "desc" },
      { usageCount: "asc" },
      { createdAt: "desc" },
    ],
  })

  return { data: clips }
})
