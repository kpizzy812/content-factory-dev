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
 *
 * Между `create` и `uploadFile` есть окно: обрыв процесса или сети оставит
 * строку без объекта в хранилище. Дедуп-ветка это не игнорирует — она
 * проверяет `storage.exists(...)` и перезаливает, если объекта нет, не
 * заводя вторую строку (`@@unique([characterId, sha1])` и не позволил бы).
 */

import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"

import { prisma } from "../prisma"
import { getStorageDriver } from "../storage"
import type { StorageDriver } from "../storage"
import { StorageKeys } from "../storage/keys"
import { normalizeRecording, probeRecordingMeta } from "./ffmpeg-adapter"
import type { RecordingMeta } from "./ffmpeg-adapter"

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
  /** true — такой оригинал уже заливали (или перезалили после сироты), файл не нормализовался повторно. */
  deduped: boolean
  storageKey: string
  durationSec: number
}

/**
 * Зависимости вынесены параметром, чтобы интеграционные тесты подменяли
 * ffmpeg-транскод и заливку в хранилище фейками (никакого реального процесса
 * и сети), а саму функцию — с её порядком операций, дедупом и отказами —
 * гоняли на живой тестовой БД.
 */
export interface SaveRecordingDependencies {
  sha1OfFile: (path: string) => Promise<string>
  normalizeRecording: (inputPath: string, outputPath: string) => Promise<void>
  probeRecordingMeta: (path: string) => Promise<RecordingMeta>
  getStorageDriver: () => Pick<StorageDriver, "exists" | "uploadFile" | "providerName">
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

const defaultDependencies: SaveRecordingDependencies = {
  sha1OfFile,
  normalizeRecording,
  probeRecordingMeta,
  getStorageDriver,
}

/**
 * ffprobe (через `getVideoDuration`) при неразобранной длительности не
 * бросает, а резолвит 0 — молчаливая ложь. Ноль в non-nullable `durationSec`
 * отравляет запись навсегда: дедуп будет возвращать его вечно, а нарезка
 * окна под фактическую реплику (следующие задачи плана) получит верхнюю
 * границу 0 и не вернёт ни одного окна. Отказ честнее выдуманного значения.
 */
function assertMeasurableDuration(durationSec: number, path: string): void {
  if (!(durationSec > 0)) {
    throw new Error(`Не удалось определить длительность записи: ${path}`)
  }
}

export async function saveRecording(
  input: SaveRecordingInput,
  deps: SaveRecordingDependencies = defaultDependencies,
): Promise<SaveRecordingResult> {
  const sha1 = await deps.sha1OfFile(input.originalPath)
  const storage = deps.getStorageDriver()

  const existing = await prisma.presenterRecording.findUnique({
    where: { characterId_sha1: { characterId: input.characterId, sha1 } },
  })

  if (existing) {
    const objectExists = await storage.exists(existing.storageKey)
    if (objectExists) {
      return {
        recordingId: existing.id,
        deduped: true,
        storageKey: existing.storageKey,
        durationSec: existing.durationSec,
      }
    }

    // Строка есть, объекта в хранилище нет — сирота после обрыва между
    // `create` и `uploadFile`. Чиним ту же строку, вторую не создаём.
    await deps.normalizeRecording(input.originalPath, input.normalizedPath)
    const meta = await deps.probeRecordingMeta(input.normalizedPath)
    assertMeasurableDuration(meta.durationSec, input.normalizedPath)
    const size = await stat(input.normalizedPath)

    await storage.uploadFile(existing.storageKey, input.normalizedPath, { contentType: "video/mp4" })

    const repaired = await prisma.presenterRecording.update({
      where: { id: existing.id },
      data: {
        durationSec: meta.durationSec,
        fps: meta.fps,
        width: meta.width,
        height: meta.height,
        bytes: size.size,
      },
    })

    return {
      recordingId: repaired.id,
      deduped: true,
      storageKey: repaired.storageKey,
      durationSec: repaired.durationSec,
    }
  }

  await deps.normalizeRecording(input.originalPath, input.normalizedPath)
  const meta = await deps.probeRecordingMeta(input.normalizedPath)
  assertMeasurableDuration(meta.durationSec, input.normalizedPath)
  const size = await stat(input.normalizedPath)
  const storageKey = StorageKeys.presenterRecording(input.appId, input.characterId, sha1, "mp4")

  const row = await prisma.presenterRecording.create({
    data: {
      characterId: input.characterId,
      storageKey,
      storageProvider: storage.providerName,
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

  await storage.uploadFile(storageKey, input.normalizedPath, { contentType: "video/mp4" })

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
