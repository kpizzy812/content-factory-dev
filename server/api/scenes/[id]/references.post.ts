/**
 * POST /api/scenes/:id/references
 * multipart/form-data: `files` (image/*), опциональное поле `kind` (mood|shot|environment|other).
 * Загружает референс-кадры сцены в GCS под zavodcamp/apps/{appId}/scenes/{sceneId}/refs/{sha1}.{ext},
 * создаёт SceneReferenceImage записи, fire-and-forget vision-анализ.
 */
import { createHash } from "node:crypto"
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { storageKeyToLegacyUrl } from "~~/server/utils/storage/download-to-storage"
import { scheduleScenePhotoAnalysis } from "~~/server/utils/agents/character-photo-analyzer"

const MAX_FILE_BYTES = 20 * 1024 * 1024
const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}
const KINDS = ["mood", "shot", "environment", "other"] as const

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const scene = await prisma.scene.findUnique({ where: { id }, select: { id: true, appId: true } })
  if (!scene) throw createError({ statusCode: 404, message: "Сцена не найдена" })

  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "script-generator",
    appId: scene.appId,
  })

  const parts = await readMultipartFormData(event)
  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, message: "Файлы не получены" })
  }

  let chosenKind = "mood" as (typeof KINDS)[number]
  const fileParts: typeof parts = []
  for (const p of parts) {
    if (p.name === "kind" && p.data) {
      const v = p.data.toString("utf-8").trim() as (typeof KINDS)[number]
      if (KINDS.includes(v)) chosenKind = v
    } else if (p.name === "files" && p.filename && p.data) {
      fileParts.push(p)
    }
  }
  if (fileParts.length === 0) throw createError({ statusCode: 400, message: "Поле `files` пустое" })

  const storage = getStorageDriver()
  const createdIds: string[] = []

  for (const part of fileParts) {
    const mime = (part.type || "").toLowerCase()
    const ext = ALLOWED_MIME[mime]
    if (!ext) throw createError({ statusCode: 415, message: `Неподдерживаемый формат: ${mime || "unknown"}` })
    if (part.data.length > MAX_FILE_BYTES) {
      throw createError({ statusCode: 413, message: `Файл больше ${MAX_FILE_BYTES / (1024 * 1024)} MB` })
    }

    const sha1 = createHash("sha1").update(part.data).digest("hex").slice(0, 16)
    const storageKey = StorageKeys.sceneReferenceImage(scene.appId, scene.id, sha1, ext)
    const fileUrl = storageKeyToLegacyUrl(storageKey)

    const existing = await prisma.sceneReferenceImage.findUnique({
      where: { sceneId_sha1: { sceneId: scene.id, sha1 } },
    })
    if (existing) continue

    await storage.uploadBuffer(storageKey, part.data, { contentType: mime })

    const created = await prisma.sceneReferenceImage.create({
      data: {
        sceneId: scene.id,
        kind: chosenKind,
        fileUrl,
        storageKey,
        storageProvider: storage.providerName,
        sha1,
        mimeType: mime,
        bytes: part.data.length,
        uploadedById: user.id,
      },
    })
    createdIds.push(created.id)
    scheduleScenePhotoAnalysis(created.id)
  }

  const referenceImages = await prisma.sceneReferenceImage.findMany({
    where: { sceneId: scene.id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  })

  return { data: { referenceImages, createdIds } }
})
