import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { storageKeyToLegacyUrl } from "~~/server/utils/storage/download-to-storage"
import { getVideoDuration } from "~~/server/utils/video-tools/ffmpeg"

const MAX_FILE_BYTES = 100 * 1024 * 1024
const MIN_DURATION_SEC = 2
const MAX_DURATION_SEC = 10
const ALLOWED_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
}

function readTextField(parts: Awaited<ReturnType<typeof readMultipartFormData>>, name: string): string | null {
  const part = parts?.find(item => item.name === name && item.data)
  return part?.data?.toString("utf-8").trim() || null
}

async function probeDuration(data: Buffer, ext: string): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "presenter-source-"))
  const filePath = join(dir, `source.${ext}`)
  try {
    await writeFile(filePath, data)
    return await getVideoDuration(filePath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export default defineEventHandler(async (event) => {
  const characterId = getRouterParam(event, "id")
  if (!characterId) throw createError({ statusCode: 400, message: "id обязателен" })

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, appId: true },
  })
  if (!character) throw createError({ statusCode: 404, message: "Персонаж не найден" })

  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "script-generator",
    appId: character.appId,
  })

  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw createError({ statusCode: 400, message: "Файлы не получены" })

  const fileParts = parts.filter(part => part.name === "files" && part.filename && part.data)
  if (!fileParts.length) throw createError({ statusCode: 400, message: "Поле `files` пустое" })

  const tags = (readTextField(parts, "tags") || "")
    .split(/[\n,]/)
    .map(tag => tag.trim())
    .filter(Boolean)
  const outfit = readTextField(parts, "outfit")
  const background = readTextField(parts, "background")
  const gesture = readTextField(parts, "gesture")

  const prepared: Array<{
    data: Buffer
    filename: string
    mime: string
    ext: string
    sha1: string
    durationSec: number
  }> = []

  for (const part of fileParts) {
    const mime = (part.type || "").toLowerCase()
    const ext = ALLOWED_MIME[mime]
    if (!ext) {
      throw createError({ statusCode: 415, message: `Неподдерживаемый формат: ${mime || "unknown"}` })
    }
    if (part.data.length > MAX_FILE_BYTES) {
      throw createError({ statusCode: 413, message: "Один файл должен быть не больше 100 MB" })
    }

    const durationSec = await probeDuration(part.data, ext)
    if (durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) {
      throw createError({
        statusCode: 422,
        message: `${part.filename}: длительность должна быть от 2 до 10 секунд, получено ${durationSec.toFixed(1)} сек`,
      })
    }

    prepared.push({
      data: part.data,
      filename: part.filename || `source.${ext}`,
      mime,
      ext,
      sha1: createHash("sha1").update(part.data).digest("hex").slice(0, 16),
      durationSec: Math.round(durationSec * 100) / 100,
    })
  }

  const storage = getStorageDriver()
  const createdIds: string[] = []
  for (const item of prepared) {
    const existing = await prisma.presenterSourceClip.findUnique({
      where: { characterId_sha1: { characterId, sha1: item.sha1 } },
    })
    if (existing) continue

    const storageKey = StorageKeys.presenterSourceClip(character.appId, characterId, item.sha1, item.ext)
    await storage.uploadBuffer(storageKey, item.data, { contentType: item.mime })
    const created = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        name: item.filename,
        fileUrl: storageKeyToLegacyUrl(storageKey),
        storageKey,
        storageProvider: storage.providerName,
        sha1: item.sha1,
        mimeType: item.mime,
        bytes: item.data.length,
        durationSec: item.durationSec,
        tags,
        outfit,
        background,
        gesture,
        uploadedById: user.id,
      },
    })
    createdIds.push(created.id)
  }

  const clips = await prisma.presenterSourceClip.findMany({
    where: { characterId, isActive: true },
    orderBy: [{ usageCount: "asc" }, { createdAt: "desc" }],
  })
  return { data: { clips, createdIds } }
})
