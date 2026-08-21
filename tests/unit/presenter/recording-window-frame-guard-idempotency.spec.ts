/**
 * Minor 2, фикс-раунд 1 ревью долга плана A: гонка идемпотентности в
 * guardRecordingWindowFrame (флаг retriedUsageBelongsToOther,
 * server/utils/presenter/recording-window-frame-guard.ts) — единственная
 * правка продакшн-логики мелочи 5.1 не была покрыта НИ ОДНИМ тестом.
 * Оба существующих теста tests/integration/presenter-recording.spec.ts
 * (describe "восстановление после отказа") идут по ветке "строка наша"
 * (idempotency: null) — ветка "строка чужая" (idempotency: "existing") не
 * исполнялась вовсе.
 *
 * DB-free: guard тянет reserveRecordingWindow статическим импортом из
 * ../presenter-recording-selector (recording-window-frame-guard.ts:34) —
 * подменяем его вместе с prisma и ./ffmpeg-adapter/./perceptual-hash/
 * ./recording-window-frame-similarity, чтобы управлять решением
 * "похож/не похож" и исходом reserveRecordingWindow без реального ffmpeg и БД.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  usageFindMany: vi.fn(),
  usageDelete: vi.fn(),
  usageUpdate: vi.fn(),
  usageCreate: vi.fn(),
  reserveRecordingWindow: vi.fn(),
  cutRecordingWindow: vi.fn(),
  grayscaleThumbnail: vi.fn(),
  dHashFromGrayscale: vi.fn(),
  findSimilarRecentFrame: vi.fn(),
}))

vi.mock("~~/server/utils/prisma", () => ({
  prisma: {
    presenterRecordingUsage: {
      findMany: h.usageFindMany,
      delete: h.usageDelete,
      update: h.usageUpdate,
      create: h.usageCreate,
    },
  },
}))

// Nit 5, ре-ревью фикс-раунда 1: раньше здесь была рукописная копия
// prismaErrorCode — мёртвый груз (в обоих тестах ниже delete() всегда
// резолвится, .catch не срабатывает вовсе), которая к тому же повторяла ту
// самую ошибку, за которую поймали Important 1 (переписанная в тест
// продакшн-логика). vi.importActual тянет НАСТОЯЩИЙ модуль — это безопасно,
// его собственный `import { prisma } from "./prisma"` перехватывается тем же
// vi.mock("~~/server/utils/prisma", ...) выше, реального подключения к БД не
// происходит.
vi.mock("~~/server/utils/presenter-recording-selector", async () => {
  const actual = await vi.importActual<typeof import("~~/server/utils/presenter-recording-selector")>(
    "~~/server/utils/presenter-recording-selector",
  )
  return {
    ...actual,
    reserveRecordingWindow: h.reserveRecordingWindow,
  }
})

vi.mock("~~/server/utils/presenter/ffmpeg-adapter", () => ({
  cutRecordingWindow: h.cutRecordingWindow,
  ffmpegIngestDependencies: { grayscaleThumbnail: h.grayscaleThumbnail },
}))

vi.mock("~~/server/utils/presenter/perceptual-hash", () => ({
  dHashFromGrayscale: h.dHashFromGrayscale,
}))

vi.mock("~~/server/utils/presenter/recording-window-frame-similarity", () => ({
  findSimilarRecentFrame: h.findSimilarRecentFrame,
}))

const { guardRecordingWindowFrame } = await import("~~/server/utils/presenter/recording-window-frame-guard")

/** Окно первой попытки: recording-a, [0, 4), уже зарезервировано под (videoId=100, sceneIndex=0). */
const FIRST_WINDOW = {
  recordingId: "rec-a",
  storageKey: "sk-a",
  startSec: 0,
  endSec: 4,
  durationSec: 4,
  usageId: "usage-first",
  reused: false,
  overlapSec: 0,
  idempotency: null,
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    characterId: "char-1",
    videoId: 100,
    sceneIndex: 0,
    requiredSec: 4,
    fps: 30,
    window: FIRST_WINDOW,
    windowPath: "/tmp/window.mp4",
    retryWindowPath: "/tmp/window-retry.mp4",
    recordingPath: "/tmp/recording.mp4",
    ensureRecordingDownloaded: vi.fn(async () => "/tmp/recording.mp4"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Похожесть кадра всегда "да" — заводит guard в ветку перерезервирования,
  // где и живёт проверяемая гонка.
  h.usageFindMany.mockResolvedValue([{ frameHash: "recent-hash" }])
  h.usageDelete.mockResolvedValue(undefined)
  h.usageUpdate.mockResolvedValue(undefined)
  h.usageCreate.mockResolvedValue(undefined)
  h.grayscaleThumbnail.mockResolvedValue(new Uint8Array(1))
  h.dHashFromGrayscale.mockReturnValue("first-window-hash")
  h.findSimilarRecentFrame.mockReturnValue("recent-hash")
  // Нарезка второй попытки падает ВСЕГДА в этом файле — именно этот отказ
  // (уже ПОСЛЕ успешного reserveRecordingWindow) заводит catch-ветку с
  // восстановлением, которую и проверяют оба теста ниже.
  h.cutRecordingWindow.mockRejectedValue(new Error("нарезка второй попытки упала"))
})

describe("guardRecordingWindowFrame: гонка идемпотентности при отказе после успешного перерезервирования", () => {
  it("строка чужая (idempotency: existing) — не переписывается; интервал первого окна защищён строкой БЕЗ ключа идемпотентности", async () => {
    h.reserveRecordingWindow.mockResolvedValue({
      recordingId: "rec-a",
      storageKey: "sk-a",
      startSec: 10,
      endSec: 14,
      durationSec: 4,
      usageId: "usage-foreign",
      reused: false,
      overlapSec: 0,
      idempotency: "existing",
    })

    await expect(guardRecordingWindowFrame(baseInput())).rejects.toThrow("нарезка второй попытки упала")

    // Чужая строка (usage-foreign, принадлежащая параллельному прогону той же
    // сцены) не тронута вовсе.
    expect(h.usageUpdate).not.toHaveBeenCalled()

    // Интервал ПЕРВОГО окна (реально уходящий в ролик) всё равно защищён —
    // служебной строкой без ключа идемпотентности, а не кражей чужой (Minor 1
    // фикс-раунда 1 ревью).
    expect(h.usageCreate).toHaveBeenCalledTimes(1)
    expect(h.usageCreate).toHaveBeenCalledWith({
      data: {
        recordingId: "rec-a",
        startSec: 0,
        endSec: 4,
        videoId: null,
        sceneIndex: null,
        frameHash: "first-window-hash",
      },
    })
  })

  it("строка своя (idempotency: null) — прежнее поведение не изменилось: update ЭТОЙ строки границами первого окна", async () => {
    h.reserveRecordingWindow.mockResolvedValue({
      recordingId: "rec-a",
      storageKey: "sk-a",
      startSec: 10,
      endSec: 14,
      durationSec: 4,
      usageId: "usage-mine",
      reused: false,
      overlapSec: 0,
      idempotency: null,
    })

    await expect(guardRecordingWindowFrame(baseInput())).rejects.toThrow("нарезка второй попытки упала")

    // Своя строка обновлена границами первого окна (Important 2, фикс-раунд 1
    // ревью задачи 6b) — новый флаг retriedUsageBelongsToOther эту ветку не
    // задел.
    expect(h.usageCreate).not.toHaveBeenCalled()
    expect(h.usageUpdate).toHaveBeenCalledTimes(1)
    expect(h.usageUpdate).toHaveBeenCalledWith({
      where: { id: "usage-mine" },
      data: {
        recordingId: "rec-a",
        startSec: 0,
        endSec: 4,
        frameHash: "first-window-hash",
      },
    })
  })
})
