/**
 * POST /api/characters/:id/source-recordings — эндпоинт заливки не был
 * покрыт НИ ОДНИМ тестом (долг плана A, пункт 1). Обязательный тест плана A
 * закрыл слой НИЖЕ (сам reingestRecording, tests/integration/presenter-recording.spec.ts),
 * а не сам эндпоинт — у него две несимметричные ветки (первая заливка через
 * инлайн-код нарезки vs повторная заливка через делегирование в
 * reingestRecording), и обе даже не исполнялись.
 *
 * DB-free: обработчик импортируется напрямую, h3-глобалы и prisma подменяются
 * в globalThis (в server/** они приходят из auto-import Nuxt), модульные
 * импорты — через vi.mock. По образцу tests/unit/fixes/posting-jobs-api-account.spec.ts.
 *
 * Ветка "saveRecording упал" через настоящий Nitro не воспроизводится вовсе
 * (модуль в отдельном процессе сервера не подменить), а ветка дедупа
 * потребовала бы гонять полный ffmpeg-ingest дважды — отсюда выбор DB-free
 * формы теста для ВСЕГО эндпоинта, а не только этой ветки.
 *
 * @vitest-environment node
 */
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** Ошибка h3: createError кидает объект со statusCode/statusMessage/data. */
class FakeHttpError extends Error {
  statusCode: number
  statusMessage?: string
  data?: Record<string, unknown>

  constructor(params: { statusCode?: number, statusMessage?: string, message?: string, data?: Record<string, unknown> }) {
    super(params.message ?? params.statusMessage ?? "ошибка")
    this.statusCode = params.statusCode ?? 500
    this.statusMessage = params.statusMessage
    this.data = params.data
  }
}

interface MultipartPart {
  name: string
  filename?: string
  type?: string
  data: Buffer
}

const h = vi.hoisted(() => ({
  saveRecording: vi.fn(),
  reingestRecording: vi.fn(),
  markIngestRunning: vi.fn(async () => undefined),
  markIngestCompleted: vi.fn(async () => undefined),
  markIngestFailed: vi.fn(async () => undefined),
  ingestPresenterRecording: vi.fn(),
  uploadBuffer: vi.fn(async () => undefined),
  clipFindUnique: vi.fn(async () => null),
  clipFindMany: vi.fn(async () => []),
  clipCreate: vi.fn(),
}))

/** Тот же класс, что и в реальном recording-store.ts — эндпоинт ловит его через instanceof. */
class RecordingIngestRunningError extends Error {
  constructor(recordingId: string) {
    super(`Нарезка записи ${recordingId} уже идёт`)
    this.name = "RecordingIngestRunningError"
  }
}

vi.mock("~~/server/utils/presenter/recording-store", () => ({
  RecordingIngestRunningError,
  saveRecording: h.saveRecording,
  reingestRecording: h.reingestRecording,
  markIngestRunning: h.markIngestRunning,
  markIngestCompleted: h.markIngestCompleted,
  markIngestFailed: h.markIngestFailed,
}))

vi.mock("~~/server/utils/presenter/ingest-runner", () => ({
  ingestPresenterRecording: h.ingestPresenterRecording,
}))

// Реальный ffmpeg-adapter.ts статически тянет video-tools/ffmpeg.ts (setFfmpegPath
// на уровне модуля при заданном FFMPEG_PATH) — этот тест обязан оставаться зелёным
// и с заданным FFMPEG_PATH/FFPROBE_PATH тоже, поэтому модуль подменяется целиком.
vi.mock("~~/server/utils/presenter/ffmpeg-adapter", () => ({
  ffmpegIngestDependencies: {},
}))

vi.mock("~~/server/utils/storage", () => ({
  getStorageDriver: () => ({
    providerName: "gcs",
    uploadBuffer: h.uploadBuffer,
  }),
}))

vi.mock("~~/server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: (key: string) => `https://legacy.example/${key}`,
}))

const GLOBAL_KEYS = [
  "defineEventHandler",
  "getRouterParam",
  "createError",
  "readMultipartFormData",
  "requireScopedAccess",
  "prisma",
] as const

const saved = new Map<string, unknown>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!saved.has(name)) saved.set(name, holder[name])
  holder[name] = value
}

const CHARACTER_ID = "char-1"
const APP_ID = 42

function installHandlerGlobals(): void {
  setGlobal("defineEventHandler", (fn: unknown) => fn)
  setGlobal("getRouterParam", (event: { params: Record<string, string> }, name: string) => event.params[name])
  setGlobal("createError", (params: ConstructorParameters<typeof FakeHttpError>[0]) => new FakeHttpError(params))
  setGlobal("readMultipartFormData", async (event: { parts: MultipartPart[] }) => event.parts)
  setGlobal("requireScopedAccess", async () => ({ id: 7 }))
  setGlobal("prisma", {
    character: {
      findUnique: async () => ({ id: CHARACTER_ID, appId: APP_ID }),
    },
    presenterSourceClip: {
      findMany: h.clipFindMany,
      findUnique: h.clipFindUnique,
      create: h.clipCreate,
    },
  })
}

/** Файл-часть multipart для поля `file` — единственное обязательное поле. */
function filePart(bytes = "поддельные-байты-видео"): MultipartPart {
  return { name: "file", filename: "recording.mp4", type: "video/mp4", data: Buffer.from(bytes) }
}

function textPart(name: string, value: string): MultipartPart {
  return { name, data: Buffer.from(value) }
}

async function callHandler(parts: MultipartPart[]) {
  installHandlerGlobals()
  const handler = (await import("~~/server/api/characters/[id]/source-recordings/index.post")).default as unknown as (
    event: unknown,
  ) => Promise<unknown>
  return handler({ params: { id: CHARACTER_ID }, parts })
}

let workDirs: string[] = []

/** Вырезает workDir из аргумента ingestPresenterRecording — clip-файлы должны реально лежать на диске (readFile настоящий). */
async function writeClipFile(outputDir: string, name: string, bytes = "клип"): Promise<string> {
  workDirs.push(outputDir)
  const filePath = join(outputDir, name)
  await writeFile(filePath, bytes)
  return filePath
}

beforeEach(() => {
  vi.clearAllMocks()
  h.markIngestRunning.mockResolvedValue(undefined)
  h.markIngestCompleted.mockResolvedValue(undefined)
  h.markIngestFailed.mockResolvedValue(undefined)
  h.uploadBuffer.mockResolvedValue(undefined)
  h.clipFindUnique.mockResolvedValue(null)
  h.clipFindMany.mockResolvedValue([])
  h.clipCreate.mockImplementation(async ({ data }: { data: { id?: string } }) => ({ id: data.id ?? `clip-${Math.random()}` }))
  workDirs = []
})

afterEach(async () => {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const key of GLOBAL_KEYS) {
    if (saved.has(key)) holder[key] = saved.get(key)
  }
  saved.clear()
  // presenter-ingest-* временные каталоги реального workDir подчищаются самим
  // эндпоинтом (finally { rm(workDir, ...) }) — здесь только подчистка на
  // случай, если тест упал до этого finally.
  await Promise.all(workDirs.map(dir => rm(dir, { recursive: true, force: true }).catch(() => {})))
})

describe("POST /api/characters/:id/source-recordings — первая заливка", () => {
  it("ведёт себя как раньше и отдаёт прежние поля ответа; reingestRecording не вызывается", async () => {
    h.saveRecording.mockResolvedValue({ recordingId: "rec-1", deduped: false, storageKey: "sk-1", durationSec: 12 })
    h.ingestPresenterRecording.mockImplementation(async (input: { outputDir: string }) => {
      const clipPath = await writeClipFile(input.outputDir, "clip-001.mp4")
      return {
        durationSec: 12,
        clips: [{ filePath: clipPath, startSec: 0, endSec: 5, durationSec: 5, perceptualHash: "hash1" }],
        skipped: [],
        sceneDetectionFailed: false,
        boundarySource: "silence",
        similarClips: 0,
      }
    })

    const res = await callHandler([filePart()]) as { data: Record<string, unknown> }

    expect(h.reingestRecording).not.toHaveBeenCalled()
    expect(h.ingestPresenterRecording).toHaveBeenCalledTimes(1)
    expect(h.markIngestRunning).toHaveBeenCalledWith("rec-1")
    expect(h.markIngestCompleted).toHaveBeenCalledWith("rec-1")
    expect(h.markIngestFailed).not.toHaveBeenCalled()

    // Ровно прежний набор полей ответа — ни больше, ни меньше.
    expect(Object.keys(res.data).sort()).toEqual([
      "acceptedCount",
      "boundarySource",
      "createdIds",
      "deduped",
      "durationSec",
      "recordingId",
      "recordingName",
      "recordingSaveWarning",
      "sceneDetectionFailed",
      "similarClips",
      "skipped",
    ].sort())
    expect(res.data).toMatchObject({
      recordingId: "rec-1",
      deduped: false,
      recordingSaveWarning: null,
      recordingName: "recording.mp4",
      durationSec: 12,
      sceneDetectionFailed: false,
      boundarySource: "silence",
      similarClips: 0,
      acceptedCount: 1,
      skipped: [],
    })
    expect((res.data.createdIds as string[])).toHaveLength(1)

    // Созданный клип получает recordingId сохранённой записи.
    expect(h.clipCreate).toHaveBeenCalledTimes(1)
    const createArgs = h.clipCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(createArgs.data.recordingId).toBe("rec-1")
  })
})

describe("POST /api/characters/:id/source-recordings — повторная заливка того же файла (deduped)", () => {
  it("делегирует ВСЮ перенарезку в reingestRecording; инлайн-путь нарезки не тронут", async () => {
    h.saveRecording.mockResolvedValue({ recordingId: "rec-2", deduped: true, storageKey: "sk-2", durationSec: 20 })
    h.reingestRecording.mockResolvedValue({
      createdIds: ["clip-a", "clip-b"],
      skipped: [{ startSec: 1, endSec: 2, reason: "duplicate" }],
      similarClips: 1,
      deactivatedClips: 3,
      boundarySource: "silence",
      sceneDetectionFailed: false,
      durationSec: 20,
    })

    const res = await callHandler([
      filePart(),
      textPart("maxClips", "15"),
      textPart("tags", "a,b"),
      textPart("outfit", "костюм"),
      textPart("background", "студия"),
      textPart("gesture", "жест"),
    ]) as { data: Record<string, unknown> }

    // Делегирование — единственное доказательство: гашение старого разреза
    // живёт ВНУТРИ reingestRecording (tests/integration/presenter-recording.spec.ts:694),
    // здесь мы доказываем только то, что эндпоинт зовёт его и НЕ делает
    // инлайн-нарезку сам.
    expect(h.reingestRecording).toHaveBeenCalledTimes(1)
    const [recordingIdArg, optionsArg] = h.reingestRecording.mock.calls[0]!
    expect(recordingIdArg).toBe("rec-2")
    expect(optionsArg).toMatchObject({
      maxClips: 15,
      tags: ["a", "b"],
      outfit: "костюм",
      background: "студия",
      gesture: "жест",
      uploadedById: 7,
    })

    expect(h.ingestPresenterRecording).not.toHaveBeenCalled()
    expect(h.clipCreate).not.toHaveBeenCalled()
    expect(h.markIngestRunning).not.toHaveBeenCalled()
    expect(h.markIngestCompleted).not.toHaveBeenCalled()

    expect(res.data).toMatchObject({
      recordingId: "rec-2",
      deduped: true,
      recordingSaveWarning: null,
      createdIds: ["clip-a", "clip-b"],
      acceptedCount: 2,
      boundarySource: "silence",
      similarClips: 1,
      sceneDetectionFailed: false,
    })
  })

  it("RecordingIngestRunningError из reingestRecording превращается в 409", async () => {
    h.saveRecording.mockResolvedValue({ recordingId: "rec-3", deduped: true, storageKey: "sk-3", durationSec: 20 })
    h.reingestRecording.mockRejectedValue(new RecordingIngestRunningError("rec-3"))

    const err = await callHandler([filePart()]).catch(e => e)

    expect(err).toBeInstanceOf(FakeHttpError)
    expect(err.statusCode).toBe(409)
    expect(h.markIngestFailed).not.toHaveBeenCalled()
  })

  it("любая другая ошибка reingestRecording пробрасывается как есть и НЕ помечает запись failed", async () => {
    h.saveRecording.mockResolvedValue({ recordingId: "rec-4", deduped: true, storageKey: "sk-4", durationSec: 20 })
    const originalError = new Error("ffmpeg упал внутри reingestRecording")
    h.reingestRecording.mockRejectedValue(originalError)

    const err = await callHandler([filePart()]).catch(e => e)

    expect(err).toBe(originalError)
    expect(err).not.toBeInstanceOf(FakeHttpError)
    // reingestRecording сам уже перевёл статус в failed изнутри своего try/catch —
    // дублировать это в эндпоинте нельзя (см. докстринг в коде обработчика).
    expect(h.markIngestFailed).not.toHaveBeenCalled()
  })
})

describe("POST /api/characters/:id/source-recordings — отказ saveRecording", () => {
  it("не роняет нарезку: клипы создаются без recordingId, ответ несёт recordingSaveWarning", async () => {
    h.saveRecording.mockRejectedValue(new Error("ffmpeg не смог нормализовать запись"))
    h.ingestPresenterRecording.mockImplementation(async (input: { outputDir: string }) => {
      const clipPath = await writeClipFile(input.outputDir, "clip-001.mp4")
      return {
        durationSec: 8,
        clips: [{ filePath: clipPath, startSec: 0, endSec: 4, durationSec: 4, perceptualHash: "hash2" }],
        skipped: [],
        sceneDetectionFailed: false,
        boundarySource: "none",
        similarClips: 0,
      }
    })

    const res = await callHandler([filePart()]) as { data: Record<string, unknown> }

    expect(res.data.recordingId).toBeNull()
    expect(res.data.deduped).toBe(false)
    expect(typeof res.data.recordingSaveWarning).toBe("string")
    expect(res.data.recordingSaveWarning as string).toContain("ffmpeg не смог нормализовать запись")

    expect(h.clipCreate).toHaveBeenCalledTimes(1)
    const createArgs = h.clipCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(createArgs.data.recordingId).toBeNull()

    // Записи нет (saved === null) — статусные функции не вызывались вовсе.
    expect(h.markIngestRunning).not.toHaveBeenCalled()
    expect(h.markIngestCompleted).not.toHaveBeenCalled()
    expect(h.markIngestFailed).not.toHaveBeenCalled()
  })
})

describe("POST /api/characters/:id/source-recordings — отказ ingestPresenterRecording (дешёвый бонус)", () => {
  it("при успешном saveRecording вызывает markIngestFailed и пробрасывает ИСХОДНУЮ ошибку", async () => {
    h.saveRecording.mockResolvedValue({ recordingId: "rec-5", deduped: false, storageKey: "sk-5", durationSec: 9 })
    const originalError = new Error("нарезка упала на середине")
    h.ingestPresenterRecording.mockRejectedValue(originalError)
    // markIngestFailed сам тоже падает (БД недоступна) — наружу обязана уйти
    // ИСХОДНАЯ ошибка нарезки, а не эта вторичная.
    h.markIngestFailed.mockRejectedValue(new Error("БД недоступна — вторичная ошибка"))

    const err = await callHandler([filePart()]).catch(e => e)

    expect(err).toBe(originalError)
    expect(h.markIngestFailed).toHaveBeenCalledTimes(1)
    expect(h.markIngestFailed.mock.calls[0]![0]).toBe("rec-5")
    expect(h.markIngestFailed.mock.calls[0]![1]).toBe(originalError)
    expect(h.markIngestCompleted).not.toHaveBeenCalled()
  })
})
