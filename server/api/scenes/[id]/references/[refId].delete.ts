/**
 * DELETE /api/scenes/:id/references/:refId — удаляет SceneReferenceImage + файл из storage.
 */
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageError } from "~~/server/utils/storage/types"

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
    permissions: ["canDelete"],
    moduleSlug: "script-generator",
    appId: ref.scene.appId,
  })

  await prisma.sceneReferenceImage.delete({ where: { id: refId } })
  if (ref.storageKey) {
    try {
      await getStorageDriver().delete(ref.storageKey)
    } catch (err) {
      if (!(err instanceof StorageError) || err.code !== "NOT_FOUND") {
        console.warn("[scene-references] storage delete failed", err)
      }
    }
  }

  const referenceImages = await prisma.sceneReferenceImage.findMany({
    where: { sceneId: id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  })
  return { data: { referenceImages } }
})
