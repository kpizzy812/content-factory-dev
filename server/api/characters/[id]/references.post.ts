/**
 * POST /api/characters/:id/references
 * multipart/form-data: `files` (image/*), опциональное поле `kind` (face|body|outfit|pose|other).
 * Загружает картинки в GCS под zavodcamp/apps/{appId}/characters/{characterId}/{sha1}.{ext},
 * создаёт CharacterReferenceImage записи, возвращает обновлённый character со всеми
 * референсами.
 */
import { createHash } from "node:crypto"
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { storageKeyToLegacyUrl } from "~~/server/utils/storage/download-to-storage"
import { scheduleCharacterPhotoAnalysis } from "~~/server/utils/agents/character-photo-analyzer"
import type { CharacterReferenceKind } from "~~/shared/types/character"

const MAX_FILE_BYTES = 20 * 1024 * 1024
const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}
const KINDS: CharacterReferenceKind[] = ["face", "body", "outfit", "pose", "other"]

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const character = await prisma.character.findUnique({
    where: { id },
    select: { id: true, appId: true },
  })
  if (!character) throw createError({ statusCode: 404, message: "Персонаж не найден" })

  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "script-generator",
    appId: character.appId,
  })

  const parts = await readMultipartFormData(event)
  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, message: "Файлы не получены" })
  }

  let chosenKind: CharacterReferenceKind = "face"
  const fileParts: typeof parts = []
  for (const p of parts) {
    if (p.name === "kind" && p.data) {
      const v = p.data.toString("utf-8").trim() as CharacterReferenceKind
      if (KINDS.includes(v)) chosenKind = v
    } else if (p.name === "files" && p.filename && p.data) {
      fileParts.push(p)
    }
  }

  if (fileParts.length === 0) {
    throw createError({ statusCode: 400, message: "Поле `files` пустое" })
  }

  const storage = getStorageDriver()
  const createdIds: string[] = []

  for (const part of fileParts) {
    const mime = (part.type || "").toLowerCase()
    const ext = ALLOWED_MIME[mime]
    if (!ext) {
      throw createError({ statusCode: 415, message: `Неподдерживаемый формат: ${mime || "unknown"}` })
    }
    if (part.data.length > MAX_FILE_BYTES) {
      throw createError({ statusCode: 413, message: `Файл больше ${MAX_FILE_BYTES / (1024 * 1024)} MB` })
    }

    const sha1 = createHash("sha1").update(part.data).digest("hex").slice(0, 16)
    const storageKey = StorageKeys.characterReferenceImage(character.appId, character.id, sha1, ext)
    const fileUrl = storageKeyToLegacyUrl(storageKey)

    const existing = await prisma.characterReferenceImage.findUnique({
      where: { characterId_sha1: { characterId: character.id, sha1 } },
    })

    if (existing) continue

    await storage.uploadBuffer(storageKey, part.data, { contentType: mime })

    const created = await prisma.characterReferenceImage.create({
      data: {
        characterId: character.id,
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
    // Fire-and-forget AI vision (Anthropic) — пишет aiTags/aiCaption/aiVisualDescription
    // в запись, UI polling'ом подтянет результат.
    scheduleCharacterPhotoAnalysis(created.id)
  }

  const updated = await prisma.character.findUnique({
    where: { id: character.id },
    include: {
      referenceImages: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      },
    },
  })

  return { data: { character: updated, createdIds } }
})
