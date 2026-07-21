/**
 * POST /api/scenes/:id/references/:refId/analyze — синхронный AI vision re-run.
 */
import { analyzeScenePhoto } from "~~/server/utils/agents/character-photo-analyzer"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const refId = getRouterParam(event, "refId")
  if (!id || !refId) throw createError({ statusCode: 400, message: "id и refId обязательны" })

  const ref = await prisma.sceneReferenceImage.findUnique({
    where: { id: refId },
    include: { scene: { select: { id: true, appId: true } } },
  })
  if (!ref) throw createError({ statusCode: 404, message: "Референс не найден" })
  if (ref.scene.id !== id) throw createError({ statusCode: 404, message: "Референс принадлежит другой сцене" })

  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "script-generator",
    appId: ref.scene.appId,
  })

  await analyzeScenePhoto(refId)
  const updated = await prisma.sceneReferenceImage.findUnique({ where: { id: refId } })
  return { data: { reference: updated } }
})
