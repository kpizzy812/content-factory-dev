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
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prisma } from "../prisma"
import { getStorageDriver } from "../storage"
import type { StorageDriver } from "../storage"
import { StorageKeys } from "../storage/keys"
import { storageKeyToLegacyUrl } from "../storage/download-to-storage"
import { ffmpegIngestDependencies, normalizeRecording, probeRecordingMeta } from "./ffmpeg-adapter"
import type { RecordingMeta } from "./ffmpeg-adapter"
import { ingestPresenterRecording } from "./ingest-runner"
import type { IngestPresenterDependencies, IngestPresenterInput, IngestPresenterResult } from "./ingest-runner"

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

/** Бросается, когда нарезка этой записи уже идёт — второй параллельный запуск не начат. */
export class RecordingIngestRunningError extends Error {
  constructor(recordingId: string) {
    super(`Нарезка записи ${recordingId} уже идёт`)
    this.name = "RecordingIngestRunningError"
  }
}

export interface ReingestRecordingResult {
  createdIds: string[]
  skipped: number
  similarClips: number
}

/**
 * Зависимости `reingestRecording`, вынесенные параметром по той же причине, что
 * и у `saveRecording`: интеграционный тест подменяет скачивание из хранилища и
 * заливку клипов фейками, а саму нарезку (`ingestPresenterRecording` +
 * `ffmpegIngestDependencies`) гоняет по-настоящему на коротком фикстурном mp4 —
 * обходить нарезку моком нельзя, это и есть проверяемая логика.
 */
export interface ReingestRecordingDependencies {
  downloadToFile: (storageKey: string, localPath: string) => Promise<void>
  uploadClip: (storageKey: string, data: Buffer) => Promise<void>
  getProviderName: () => string
  ingestPresenterRecording: (
    input: IngestPresenterInput,
    ingestDeps: IngestPresenterDependencies,
  ) => Promise<IngestPresenterResult>
  ingestDependencies: IngestPresenterDependencies
}

const defaultReingestDependencies: ReingestRecordingDependencies = {
  downloadToFile: (storageKey, localPath) => getStorageDriver().downloadToFile(storageKey, localPath),
  uploadClip: async (storageKey, data) => {
    await getStorageDriver().uploadBuffer(storageKey, data, { contentType: "video/mp4" })
  },
  getProviderName: () => getStorageDriver().providerName,
  ingestPresenterRecording,
  ingestDependencies: ffmpegIngestDependencies,
}

/**
 * Перенарезать сохранённую запись по текущим правилам.
 *
 * Ради этого запись и хранится: правила нарезки менялись уже дважды (пороги
 * пауз, дедуп по первому кадру), и раньше единственным способом применить их
 * было попросить пользователя залить два гигабайта заново. Она же чинит ingest,
 * упавший на середине (`ingestStatus: "failed"`) — тот же код запускается снова
 * с той же записи, без повторной заливки.
 *
 * Дубли не создаются на уровне схемы: `@@unique([characterId, sha1])` —
 * клип с тем же содержимым просто пропускается, как и при первичной заливке.
 */
export async function reingestRecording(
  recordingId: string,
  options: { maxClips?: number } = {},
  deps: ReingestRecordingDependencies = defaultReingestDependencies,
): Promise<ReingestRecordingResult> {
  const recording = await prisma.presenterRecording.findUnique({
    where: { id: recordingId },
    include: { character: { select: { appId: true } } },
  })
  if (!recording) throw new Error(`Запись ${recordingId} не найдена`)

  // Атомарный захват статуса: если запись уже "running", `updateMany` не
  // заденет ни одной строки — второй параллельный вызов не запустит вторую
  // нарезку поверх первой (двойная оплата процессорного времени, гонка на
  // клипах). Проверка "не running" в эндпоинте закрывает частый случай
  // быстрее, эта — закрывает гонку между двумя одновременными запросами.
  const claimed = await prisma.presenterRecording.updateMany({
    where: { id: recordingId, ingestStatus: { not: "running" } },
    data: { ingestStatus: "running", ingestError: null, ingestStartedAt: new Date() },
  })
  if (claimed.count === 0) throw new RecordingIngestRunningError(recordingId)

  const workDir = await mkdtemp(join(tmpdir(), "presenter-reingest-"))
  const localPath = join(workDir, "recording.mp4")

  try {
    await deps.downloadToFile(recording.storageKey, localPath)

    const known = await prisma.presenterSourceClip.findMany({
      where: { characterId: recording.characterId, isActive: true, perceptualHash: { not: null } },
      select: { perceptualHash: true },
    })

    const result = await deps.ingestPresenterRecording(
      {
        recordingPath: localPath,
        outputDir: workDir,
        existingHashes: known.map(c => c.perceptualHash!).filter(Boolean),
        maxClips: options.maxClips,
      },
      deps.ingestDependencies,
    )

    const createdIds: string[] = []
    for (const clip of result.clips) {
      const data = await readFile(clip.filePath)
      const sha1 = createHash("sha1").update(data).digest("hex").slice(0, 16)
      const exists = await prisma.presenterSourceClip.findUnique({
        where: { characterId_sha1: { characterId: recording.characterId, sha1 } },
        select: { id: true },
      })
      if (exists) continue

      const storageKey = StorageKeys.presenterSourceClip(
        recording.character.appId, recording.characterId, sha1, "mp4",
      )
      await deps.uploadClip(storageKey, data)
      const row = await prisma.presenterSourceClip.create({
        data: {
          characterId: recording.characterId,
          recordingId: recording.id,
          name: `${recording.originalName ?? "запись"} · ${clip.startSec.toFixed(1)}-${clip.endSec.toFixed(1)}s`,
          fileUrl: storageKeyToLegacyUrl(storageKey),
          storageKey,
          storageProvider: deps.getProviderName(),
          sha1,
          mimeType: "video/mp4",
          bytes: data.length,
          durationSec: clip.durationSec,
          perceptualHash: clip.perceptualHash,
          sourceRecording: recording.originalName,
          sourceStartSec: clip.startSec,
        },
      })
      createdIds.push(row.id)
    }

    await markIngestCompleted(recordingId)
    return { createdIds, skipped: result.skipped.length, similarClips: result.similarClips }
  }
  catch (error) {
    // markIngestFailed сам может бросить (БД недоступна) — тогда наружу
    // должна уйти настоящая причина сбоя нарезки, а не эта вторичная.
    await markIngestFailed(recordingId, error).catch(() => {})
    throw error
  }
  finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
