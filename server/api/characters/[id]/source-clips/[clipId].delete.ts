export default defineEventHandler(async (event) => {
  const characterId = getRouterParam(event, "id")
  const clipId = getRouterParam(event, "clipId")
  if (!characterId || !clipId) {
    throw createError({ statusCode: 400, message: "id и clipId обязательны" })
  }

  const clip = await prisma.presenterSourceClip.findFirst({
    where: { id: clipId, characterId },
    include: { character: { select: { appId: true } } },
  })
  if (!clip) throw createError({ statusCode: 404, message: "Исходный клип не найден" })

  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "script-generator",
    appId: clip.character.appId,
  })

  await prisma.presenterSourceClip.update({
    where: { id: clip.id },
    data: { isActive: false },
  })

  const clips = await prisma.presenterSourceClip.findMany({
    where: { characterId, isActive: true },
    orderBy: [{ usageCount: "asc" }, { createdAt: "desc" }],
  })

  return { data: clips }
})
