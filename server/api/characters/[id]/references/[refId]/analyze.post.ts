/**
 * POST /api/characters/:id/references/:refId/analyze
 * Синхронный повторный запуск AI vision для одного reference photo.
 */
import { analyzeCharacterPhoto } from "~~/server/utils/agents/character-photo-analyzer"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const refId = getRouterParam(event, "refId")
  if (!id || !refId) throw createError({ statusCode: 400, message: "id и refId обязательны" })

  const ref = await prisma.characterReferenceImage.findUnique({
    where: { id: refId },
    include: { character: { select: { id: true, appId: true } } },
  })
  if (!ref) throw createError({ statusCode: 404, message: "Референс не найден" })
  if (ref.character.id !== id) {
    throw createError({ statusCode: 404, message: "Референс принадлежит другому персонажу" })
  }

  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "script-generator",
    appId: ref.character.appId,
  })

  await analyzeCharacterPhoto(refId)
  const updated = await prisma.characterReferenceImage.findUnique({ where: { id: refId } })
  return { data: { reference: updated } }
})
