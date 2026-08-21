/**
 * POST /api/characters/:id/source-recordings
 *
 * Принимает одну длинную запись ведущего, размечает сцены, режет её на пригодные
 * для lip-sync фрагменты 2-10 секунд, отбрасывает похожие и складывает принятое
 * в библиотеку исходников.
 *
 * Нарезка идёт внутри запроса, поэтому вход ограничен по размеру, а число клипов
 * с одной записи — параметром maxClips. Для больших архивов запись надо резать
 * порциями; durable-job для этого появится вместе с массовым оркестратором.
 */

import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { storageKeyToLegacyUrl } from "~~/server/utils/storage/download-to-storage"
import { ffmpegIngestDependencies } from "~~/server/utils/presenter/ffmpeg-adapter"
import { ingestPresenterRecording } from "~~/server/utils/presenter/ingest-runner"
import {
  markIngestCompleted,
  markIngestFailed,
  markIngestRunning,
  saveRecording,
} from "~~/server/utils/presenter/recording-store"

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_CLIPS = 20
const HARD_MAX_CLIPS = 60
const ALLOWED_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
}

function readTextField(parts: Awaited<ReturnType<typeof readMultipartFormData>>, name: string): string | null {
  const part = parts?.find(item => item.name === name && item.data)
  return part?.data?.toString("utf-8").trim() || null
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
  const filePart = parts?.find(part => part.name === "file" && part.filename && part.data)
  if (!filePart) throw createError({ statusCode: 400, message: "Поле `file` обязательно" })

  const mime = (filePart.type || "").toLowerCase()
  const ext = ALLOWED_MIME[mime]
  if (!ext) throw createError({ statusCode: 415, message: `Неподдерживаемый формат: ${mime || "unknown"}` })
  if (filePart.data.length > MAX_FILE_BYTES) {
    throw createError({ statusCode: 413, message: "Запись должна быть не больше 2 GB" })
  }

  const requestedMaxClips = Number(readTextField(parts, "maxClips"))
  const maxClips = Number.isFinite(requestedMaxClips) && requestedMaxClips > 0
    ? Math.min(Math.floor(requestedMaxClips), HARD_MAX_CLIPS)
    : DEFAULT_MAX_CLIPS

  const tags = (readTextField(parts, "tags") || "")
    .split(/[\n,]/)
    .map(tag => tag.trim())
    .filter(Boolean)
  const outfit = readTextField(parts, "outfit")
  const background = readTextField(parts, "background")
  const gesture = readTextField(parts, "gesture")

  // Похожесть считаем и против того, что уже лежит у этого ведущего, иначе
  // повторная загрузка соседнего дубля наполнит библиотеку одинаковыми кадрами.
  const known = await prisma.presenterSourceClip.findMany({
    where: { characterId, isActive: true, perceptualHash: { not: null } },
    select: { perceptualHash: true },
  })
  const existingHashes = known
    .map(clip => clip.perceptualHash)
    .filter((hash): hash is string => Boolean(hash))

  const workDir = await mkdtemp(join(tmpdir(), "presenter-ingest-"))
  const recordingPath = join(workDir, `recording.${ext}`)
  const normalizedPath = join(workDir, "recording-normalized.mp4")
  const recordingName = filePart.filename || `recording.${ext}`

  try {
    await writeFile(recordingPath, filePart.data)

    // Запись сохраняется нормализованной независимо от исхода нарезки на клипы —
    // она источник для будущего монтажа "от звука" (реза под фактическую длину
    // реплики), и терять её из-за сбоя в разметке сцен нельзя.
    const saved = await saveRecording({
      appId: character.appId,
      characterId,
      originalPath: recordingPath,
      normalizedPath,
      originalName: recordingName,
      originalBytes: filePart.data.length,
      uploadedById: user.id,
    })

    await markIngestRunning(saved.recordingId)

    try {
      // Нарезка идёт даже в дедуп-ветке: оператор мог залить ту же запись
      // повторно, чтобы перенарезать её по новым правилам.
      const result = await ingestPresenterRecording(
        { recordingPath, outputDir: workDir, existingHashes, maxClips },
        ffmpegIngestDependencies,
      )

      const storage = getStorageDriver()
      const created: string[] = []

      for (const clip of result.clips) {
        const data = await readFile(clip.filePath)
        const sha1 = createHash("sha1").update(data).digest("hex").slice(0, 16)

        const existing = await prisma.presenterSourceClip.findUnique({
          where: { characterId_sha1: { characterId, sha1 } },
          select: { id: true },
        })
        if (existing) continue

        const storageKey = StorageKeys.presenterSourceClip(character.appId, characterId, sha1, "mp4")
        await storage.uploadBuffer(storageKey, data, { contentType: "video/mp4" })

        const row = await prisma.presenterSourceClip.create({
          data: {
            characterId,
            recordingId: saved.recordingId,
            name: `${recordingName} · ${clip.startSec.toFixed(1)}-${clip.endSec.toFixed(1)}s`,
            fileUrl: storageKeyToLegacyUrl(storageKey),
            storageKey,
            storageProvider: storage.providerName,
            sha1,
            mimeType: "video/mp4",
            bytes: data.length,
            durationSec: clip.durationSec,
            tags,
            outfit,
            background,
            gesture,
            perceptualHash: clip.perceptualHash,
            sourceRecording: recordingName,
            sourceStartSec: clip.startSec,
            uploadedById: user.id,
          },
        })
        created.push(row.id)
      }

      await markIngestCompleted(saved.recordingId)

      return {
        data: {
          recordingId: saved.recordingId,
          deduped: saved.deduped,
          recordingName,
          durationSec: result.durationSec,
          sceneDetectionFailed: result.sceneDetectionFailed,
          // Чем размечены границы: `silence` — паузами речи, `scene` — склейками,
          // `none` — ничем, запись поделена по таймеру и резы попали в середину
          // слов. Последнее оператор обязан видеть.
          boundarySource: result.boundarySource,
          similarClips: result.similarClips,
          createdIds: created,
          acceptedCount: created.length,
          skipped: result.skipped,
        },
      }
    }
    catch (error) {
      await markIngestFailed(saved.recordingId, error)
      throw error
    }
  }
  finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
})
