/**
 * DELETE /api/characters/:id/references/:refId
 * Удаляет CharacterReferenceImage и файл из storage. Идемпотентно (NOT_FOUND
 * не считается ошибкой).
 */
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageError } from "~~/server/utils/storage/types"

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
    permissions: ["canDelete"],
    moduleSlug: "script-generator",
    appId: ref.character.appId,
  })

  await prisma.characterReferenceImage.delete({ where: { id: refId } })

  if (ref.storageKey) {
    try {
      await getStorageDriver().delete(ref.storageKey)
    } catch (err) {
      if (!(err instanceof StorageError) || err.code !== "NOT_FOUND") {
        console.warn("[character-references] storage delete failed", err)
      }
    }
  }

  const updated = await prisma.character.findUnique({
    where: { id },
    include: {
      referenceImages: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      },
    },
  })

  return { data: { character: updated } }
})
