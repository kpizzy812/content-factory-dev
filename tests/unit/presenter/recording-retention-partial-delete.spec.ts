/**
 * Мелочь 5.6 из долга плана A: «отравленная строка при частичном delete».
 *
 * applyRecordingRetention (server/utils/presenter/recording-retention.ts) удаляет
 * сначала объект в хранилище, потом строку в БД. Если объект реально снесён, а
 * `prisma.presenterRecording.delete` следом падает (сеть до БД легла, гонка),
 * строка осталась бы `completed`, указывающей на несуществующий объект —
 * reserveRecordingWindow (фильтр ingestStatus: "completed", orderBy createdAt asc)
 * выбрал бы именно её и попытался резать окно из файла, которого больше нет.
 * Флаг `objectDeleted` в раннере переводит такую строку в `failed`, чтобы
 * селектор её больше не видел — починено раньше, но не было покрыто тестом.
 *
 * DI не понадобился: applyRecordingRetention статически ничего не импортирует
 * (DB-free vitest.pure.config.ts — см. докстринг файла), но `prisma`/`storage`/
 * `logAgent` он тянет `await import(...)` ВНУТРИ функции. vi.mock перехватывает
 * модуль по его резолвнутому пути независимо от того, статический это import
 * или await import() внутри вызываемой функции — тот же приём уже используется
 * для lip-sync-runner.ts (tests/unit/fixes/lip-sync-resume-progress.spec.ts).
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(async () => undefined),
  del: vi.fn(),
  storageDelete: vi.fn(),
  logAgent: vi.fn(async () => undefined),
}))

class MockStorageError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

vi.mock("~~/server/utils/prisma", () => ({
  prisma: {
    presenterRecording: {
      findMany: h.findMany,
      update: h.update,
      delete: h.del,
    },
  },
}))

vi.mock("~~/server/utils/storage", () => ({
  getStorageDriver: () => ({ delete: h.storageDelete }),
  StorageError: MockStorageError,
}))

vi.mock("~~/server/utils/agent-logger", () => ({ logAgent: h.logAgent }))

const { applyRecordingRetention } = await import("~~/server/utils/presenter/recording-retention")

/** Строка-кандидат: auto, без активных клипов, старше срока удаления — решение всегда "delete". */
function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-poisoned-1",
    retention: "auto",
    createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    cooledAt: null,
    storageKey: "recordings/rec-poisoned-1.mp4",
    ingestStatus: "completed",
    ingestStartedAt: null,
    _count: { clips: 0 },
    usages: [],
    ...overrides,
  }
}

describe("applyRecordingRetention: отравленная строка при частичном delete", () => {
  beforeEach(() => {
    // clearAllMocks, не resetAllMocks: h.update/h.logAgent несут дефолтную
    // реализацию из vi.hoisted (async () => undefined), reset стёр бы и её.
    vi.clearAllMocks()
  })

  it("объект в хранилище удалён, но prisma.delete падает — строка переводится в failed, а не остаётся completed", async () => {
    h.findMany.mockResolvedValueOnce([candidateRow()])
    h.storageDelete.mockResolvedValueOnce(undefined)
    h.del.mockRejectedValueOnce(new Error("БД недоступна (мок)"))

    const applied = await applyRecordingRetention(Date.now())

    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ recordingId: "rec-poisoned-1", action: "delete", applied: false })

    // Объект реально удалён из хранилища ДО отказа БД.
    expect(h.storageDelete).toHaveBeenCalledWith("recordings/rec-poisoned-1.mp4")
    expect(h.del).toHaveBeenCalledWith({ where: { id: "rec-poisoned-1" } })

    // Главное: строка помечена failed, чтобы reserveRecordingWindow (фильтр
    // ingestStatus: "completed") больше не резал из объекта, которого нет.
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "rec-poisoned-1" },
      data: expect.objectContaining({ ingestStatus: "failed" }),
    })
    expect(h.logAgent).toHaveBeenCalled()
  })

  it("storage.delete падает НЕ-NOT_FOUND ошибкой раньше objectDeleted — prisma.delete не вызывается, строка не трогается", async () => {
    h.findMany.mockResolvedValueOnce([candidateRow({ id: "rec-network-1", storageKey: "recordings/rec-network-1.mp4" })])
    h.storageDelete.mockRejectedValueOnce(new Error("сеть до хранилища легла (мок)"))

    const applied = await applyRecordingRetention(Date.now())

    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ recordingId: "rec-network-1", action: "delete", applied: false })

    // Отказ произошёл ДО объектного удаления — objectDeleted остаётся false,
    // строку в БД трогать нельзя: следующий проход должен повторить попытку
    // как обычную временную ошибку, а не отметить запись failed по ошибке.
    expect(h.del).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it("storage.delete отдаёт NOT_FOUND (объект уже удалён идемпотентным драйвером) — delete строки всё равно идёт", async () => {
    h.findMany.mockResolvedValueOnce([candidateRow({ id: "rec-notfound-1", storageKey: "recordings/rec-notfound-1.mp4" })])
    h.storageDelete.mockRejectedValueOnce(new MockStorageError("NOT_FOUND", "объекта уже нет"))
    h.del.mockResolvedValueOnce(undefined)

    const applied = await applyRecordingRetention(Date.now())

    expect(applied[0]).toMatchObject({ recordingId: "rec-notfound-1", action: "delete", applied: true })
    expect(h.del).toHaveBeenCalledWith({ where: { id: "rec-notfound-1" } })
    expect(h.update).not.toHaveBeenCalled()
  })
})
