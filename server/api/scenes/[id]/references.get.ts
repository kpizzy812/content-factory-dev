/**
 * GET /api/scenes/:id/references — список референс-кадров сцены с AI-метаданными
 * (используется UI для polling статуса AI-анализа).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const scene = await prisma.scene.findUnique({ where: { id }, select: { appId: true } })
  if (!scene) throw createError({ statusCode: 404, message: "Сцена не найдена" })

  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "script-generator",
    appId: scene.appId,
  })

  const referenceImages = await prisma.sceneReferenceImage.findMany({
    where: { sceneId: id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  })
  return { data: { referenceImages } }
})
