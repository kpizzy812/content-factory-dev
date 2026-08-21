/**
 * Запись ведущего в хранилище и в БД.
 *
 * Дедуп идёт по sha1 ОРИГИНАЛА, а не нормализованного файла: нормализация
 * недетерминирована по байтам (кодек, версия ffmpeg), и дедуп по её выходу
 * пропускал бы повторную заливку того же дубля. Оригинал же приходит от
 * пользователя как есть.
 *
 * Порядок операций: сначала строка в БД со статусом `pending`, потом заливка,
 * потом `completed`. Обратный порядок оставлял бы объект в хранилище без
 * строки — сироту вне каскада удаления.
 */

import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"

import { prisma } from "../prisma"
import { getStorageDriver } from "../storage"
import { StorageKeys } from "../storage/keys"
import { normalizeRecording, probeRecordingMeta } from "./ffmpeg-adapter"

export interface SaveRecordingInput {
  appId: number
  characterId: string
  /** Оригинал во временном каталоге запроса. */
  originalPath: string
  /** Куда положить нормализованный файл до заливки. */
  normalizedPath: string
  originalName: string
  originalBytes: number
  uploadedById?: number | null
}

export interface SaveRecordingResult {
  recordingId: string
  /** true — такой оригинал уже заливали, файл повторно не нормализуется. */
  deduped: boolean
  storageKey: string
  durationSec: number
}

/** sha1 файла потоком: запись весит до двух гигабайт, в память её тянуть нельзя. */
export async function sha1OfFile(path: string): Promise<string> {
  const { createReadStream } = await import("node:fs")
  const hash = createHash("sha1")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on("data", chunk => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve())
  })
  return hash.digest("hex").slice(0, 16)
}

export async function saveRecording(input: SaveRecordingInput): Promise<SaveRecordingResult> {
  const sha1 = await sha1OfFile(input.originalPath)

  const existing = await prisma.presenterRecording.findUnique({
    where: { characterId_sha1: { characterId: input.characterId, sha1 } },
  })
  if (existing) {
    return {
      recordingId: existing.id,
      deduped: true,
      storageKey: existing.storageKey,
      durationSec: existing.durationSec,
    }
  }

  await normalizeRecording(input.originalPath, input.normalizedPath)
  const meta = await probeRecordingMeta(input.normalizedPath)
  const size = await stat(input.normalizedPath)
  const storageKey = StorageKeys.presenterRecording(input.appId, input.characterId, sha1, "mp4")

  const row = await prisma.presenterRecording.create({
    data: {
      characterId: input.characterId,
      storageKey,
      storageProvider: getStorageDriver().providerName,
      sha1,
      durationSec: meta.durationSec,
      fps: meta.fps,
      width: meta.width,
      height: meta.height,
      bytes: size.size,
      originalName: input.originalName,
      originalBytes: input.originalBytes,
      uploadedById: input.uploadedById ?? null,
      ingestStatus: "pending",
    },
  })

  await getStorageDriver().uploadFile(storageKey, input.normalizedPath, { contentType: "video/mp4" })

  return { recordingId: row.id, deduped: false, storageKey, durationSec: meta.durationSec }
}

/** Отметки состояния нарезки — по ним ingest перезапускается с места падения. */
export async function markIngestRunning(recordingId: string): Promise<void> {
  await prisma.presenterRecording.update({
    where: { id: recordingId },
    data: { ingestStatus: "running", ingestError: null, ingestStartedAt: new Date() },
  })
}

export async function markIngestCompleted(recordingId: string): Promise<void> {
  await prisma.presenterRecording.update({
    where: { id: recordingId },
    data: { ingestStatus: "completed", ingestError: null, ingestFinishedAt: new Date() },
  })
}

export async function markIngestFailed(recordingId: string, error: unknown): Promise<void> {
  await prisma.presenterRecording.update({
    where: { id: recordingId },
    data: {
      ingestStatus: "failed",
      ingestError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      ingestFinishedAt: new Date(),
    },
  })
}
