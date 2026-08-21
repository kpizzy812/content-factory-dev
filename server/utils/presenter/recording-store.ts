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
import type { IngestBoundarySource, IngestPresenterDependencies, IngestPresenterInput, IngestPresenterResult, SkippedSegment } from "./ingest-runner"
import { STALE_RUNNING_THRESHOLD_MS } from "./recording-ingest-constants"

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
  /**
   * Полный список отброшенных сегментов (не только счётчик) — Important 2
   * финального ревью: эндпоинт заливки (`source-recordings/index.post.ts`)
   * делегирует дедуп-ветку сюда и обязан вернуть оператору тот же по форме
   * ответ, что и при первой заливке (`skipped: {reason}[]`, фронт считает по
   * нему дубли/ошибки — `app/components/character/CharacterPresenterSourceClips.vue`).
   */
  skipped: SkippedSegment[]
  similarClips: number
  /** Старые активные клипы ЭТОЙ записи, не подтверждённые новым разрезом (см. reingestRecording). */
  deactivatedClips: number
  /** Чем размечены границы нового разреза — паузами речи, склейками или ничем (см. ingest-runner.ts). */
  boundarySource: IngestBoundarySource
  /** true, если ffmpeg не смог разметить сцены нового прогона (см. ingest-runner.ts). */
  sceneDetectionFailed: boolean
  /** Длительность записи, измеренная ПРИ ЭТОМ прогоне (probeDuration скачанного файла). */
  durationSec: number
}

/**
 * Зависимости `reingestRecording`, вынесенные параметром по той же причине, что
 * и у `saveRecording`: интеграционный тест подменяет скачивание из хранилища,
 * создание рабочего каталога и заливку клипов фейками, а саму нарезку
 * (`ingestPresenterRecording` + `ffmpegIngestDependencies`) гоняет по-настоящему
 * на коротком фикстурном mp4 — обходить нарезку моком нельзя, это и есть
 * проверяемая логика.
 */
export interface ReingestRecordingDependencies {
  downloadToFile: (storageKey: string, localPath: string) => Promise<void>
  uploadClip: (storageKey: string, data: Buffer) => Promise<void>
  getProviderName: () => string
  /** Рабочий каталог для скачанной записи и нарезанных клипов. Вынесен ради Important 2:
   * тест обязан уметь сымитировать отказ ДО начала нарезки (нет места на диске и т.п.). */
  createWorkDir: () => Promise<string>
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
  createWorkDir: () => mkdtemp(join(tmpdir(), "presenter-reingest-")),
  ingestPresenterRecording,
  ingestDependencies: ffmpegIngestDependencies,
}

/**
 * Перенарезать сохранённую запись по текущим правилам.
 *
 * Ради этого запись и хранится: правила нарезки менялись уже дважды (пороги
 * пауз, дедуп по первому кадру), и раньше единственным способом применить их
 * было попросить пользователя залить два гигабайта заново. Она же чинит ingest,
 * упавший на середине (`ingestStatus: "failed"` или зависший `"running"`) —
 * тот же код запускается снова с той же записи, без повторной заливки.
 *
 * Точные повторы не создаются на уровне схемы: `@@unique([characterId, sha1])` —
 * клип с тем же содержимым просто пропускается, как и при первичной заливке.
 * Но новые правила режут запись НЕ побайтово так же, как старые — старый разрез
 * этой же записи, который новый прогон не воспроизвёл, гасится через
 * `isActive: false` (не удаляется: строка и файл живы, готовые ролики не
 * задеты), иначе в активной библиотеке рядом лежат два разреза одного
 * материала — ровно дубль, который запрещает docs/PROJECT_CONTEXT.md §7.
 */
export interface ReingestRecordingOptions {
  maxClips?: number
  /**
   * Метаданные формы повторной заливки — Important 2 финального ревью:
   * эндпоинт заливки делегирует дедуп-ветку сюда, и без этого параметра
   * оператор молча терял бы tags/outfit/background/gesture/uploadedById на
   * КАЖДОЙ перенарезке (первичная заливка их проставляет, реингест — нет).
   * На подбор исходника это не влияло бы (presenter-source-selector.ts
   * фильтрует только по characterId/isActive/durationSec), но потеря
   * метаданных стала бы массовой, а не только на прямом вызове
   * reingest.post.ts (там их и раньше не было — сохраняем поведение).
   */
  tags?: string[]
  outfit?: string | null
  background?: string | null
  gesture?: string | null
  uploadedById?: number | null
}

export async function reingestRecording(
  recordingId: string,
  options: ReingestRecordingOptions = {},
  deps: ReingestRecordingDependencies = defaultReingestDependencies,
): Promise<ReingestRecordingResult> {
  const recording = await prisma.presenterRecording.findUnique({
    where: { id: recordingId },
    include: { character: { select: { appId: true } } },
  })
  if (!recording) throw new Error(`Запись ${recordingId} не найдена`)

  // Атомарный захват статуса: если запись уже "running" и это не зависший
  // прогон (см. STALE_RUNNING_THRESHOLD_MS), `updateMany` не заденет ни одной
  // строки — второй параллельный вызов не запустит вторую нарезку поверх
  // первой (двойная оплата процессорного времени, гонка на клипах). Проверка
  // "не running" в эндпоинте закрывает частый случай быстрее, эта — закрывает
  // и гонку между двумя одновременными запросами, и зависший статус после
  // убитого процесса. Условие захвата — одно выражение в одном UPDATE, иначе
  // между "прочитать статус" и "записать running" снова открылось бы окно гонки.
  const staleBefore = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS)
  const claimed = await prisma.presenterRecording.updateMany({
    where: {
      id: recordingId,
      OR: [
        { ingestStatus: { not: "running" } },
        { ingestStatus: "running", ingestStartedAt: { lt: staleBefore } },
      ],
    },
    data: { ingestStatus: "running", ingestError: null, ingestStartedAt: new Date() },
  })
  if (claimed.count === 0) throw new RecordingIngestRunningError(recordingId)

  // Всё, что идёт дальше, — внутри try: до этой правки mkdtemp (и запрос
  // staleCandidateIds) стояли ДО первого catch, и их отказ (нет места на
  // диске, нет прав — а запись весит гигабайты; обрыв БД) вылетал наружу,
  // оставляя статус "running" без причины и без шанса на повтор в ближайшие
  // STALE_RUNNING_THRESHOLD_MS.
  let workDir: string | null = null

  try {
    // Активные клипы этой записи ДО нового прогона. Всё, что новый прогон не
    // подтвердит (ни созданием, ни совпадением sha1), в конце гасится — но
    // только если новый прогон вообще что-то дал (см. ниже).
    const staleCandidateIds = new Set(
      (await prisma.presenterSourceClip.findMany({
        where: { recordingId, isActive: true },
        select: { id: true },
      })).map(clip => clip.id),
    )

    workDir = await deps.createWorkDir()
    const localPath = join(workDir, "recording.mp4")

    await deps.downloadToFile(recording.storageKey, localPath)

    // Похожесть — только против ЧУЖИХ клипов персонажа (других записей и
    // ручных загрузок). Клипы ЭТОЙ же записи исключены: иначе новый разрез
    // сравнивается сам с собой, и на границах от склеек/таймера
    // (`dropSimilar = true`, см. ingest-runner.ts) новый набор гарантированно
    // отбрасывается целиком как «похожий на старый» — перенарезка с новыми
    // порогами даёт ноль клипов вместо применения новых правил.
    const known = await prisma.presenterSourceClip.findMany({
      where: {
        characterId: recording.characterId,
        isActive: true,
        perceptualHash: { not: null },
        recordingId: { not: recordingId },
      },
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
      if (exists) {
        // Старый клип воспроизведён новым разрезом побайтово — подтверждён,
        // из кандидатов на гашение убираем (актуально, когда сам exists
        // принадлежит этой же записи; для чужой записи — безвредный no-op).
        staleCandidateIds.delete(exists.id)
        continue
      }

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
          tags: options.tags,
          outfit: options.outfit,
          background: options.background,
          gesture: options.gesture,
          perceptualHash: clip.perceptualHash,
          sourceRecording: recording.originalName,
          sourceStartSec: clip.startSec,
          uploadedById: options.uploadedById,
        },
      })
      createdIds.push(row.id)
    }

    // Гасим только то, что новый прогон реально заменил. Если он не дал ни
    // одного клипа (сбой разметки, слишком короткая запись) — не трогаем
    // старую библиотеку вообще: нечем заменить, значит нечего гасить.
    let deactivatedClips = 0
    if (result.clips.length > 0 && staleCandidateIds.size > 0) {
      const deactivated = await prisma.presenterSourceClip.updateMany({
        where: { id: { in: [...staleCandidateIds] } },
        data: { isActive: false },
      })
      deactivatedClips = deactivated.count
    }

    await markIngestCompleted(recordingId)
    return {
      createdIds,
      skipped: result.skipped,
      similarClips: result.similarClips,
      deactivatedClips,
      boundarySource: result.boundarySource,
      sceneDetectionFailed: result.sceneDetectionFailed,
      durationSec: result.durationSec,
    }
  }
  catch (error) {
    // markIngestFailed сам может бросить (БД недоступна) — тогда наружу
    // должна уйти настоящая причина сбоя нарезки, а не эта вторичная.
    await markIngestFailed(recordingId, error).catch(() => {})
    throw error
  }
  finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
