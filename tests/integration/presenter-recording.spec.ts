import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"
import {
  markIngestCompleted,
  markIngestFailed,
  markIngestRunning,
  saveRecording,
} from "~~/server/utils/presenter/recording-store"
import type { SaveRecordingDependencies } from "~~/server/utils/presenter/recording-store"

let appId: number
let characterId: string

// beforeEach, не beforeAll: tests/setup.ts делает TRUNCATE всех таблиц public
// после КАЖДОГО теста (см. afterEach там же), поэтому app/character нужно
// пересоздавать перед каждым it — состояние между тестами не переживает.
beforeEach(async () => {
  const app = await prisma.app.create({ data: { name: "presenter-recording-test" } })
  appId = app.id
  const character = await prisma.character.create({
    data: { appId, name: "Ведущая" },
  })
  characterId = character.id
})

describe("схема записей ведущего", () => {
  it("хранит нормализованную запись с дедупом по оригиналу", async () => {
    const created = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/aaaa1111bbbb2222.mp4`,
        storageProvider: "gcs",
        sha1: "aaaa1111bbbb2222",
        durationSec: 612.4,
        fps: 30,
        width: 1080,
        height: 1920,
        bytes: 340_000_000,
        originalName: "dubl-01.mov",
        originalBytes: 1_900_000_000,
      },
    })

    expect(created.retention).toBe("auto")
    expect(created.ingestStatus).toBe("pending")

    // Повторная заливка того же ОРИГИНАЛА не создаёт вторую запись.
    await expect(prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "любой другой ключ",
        sha1: "aaaa1111bbbb2222",
        durationSec: 612.4,
        originalName: "dubl-01-copy.mov",
      },
    })).rejects.toThrow()
  })

  it("связывает клип с записью-родителем, но не требует её", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-parent",
        sha1: "parent1111",
        durationSec: 60,
        originalName: "parent.mov",
      },
    })

    const withParent = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        recordingId: recording.id,
        fileUrl: "https://cdn/clip-1.mp4",
        sha1: "clip1111",
        durationSec: 4.2,
      },
    })
    const orphan = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        fileUrl: "https://cdn/clip-2.mp4",
        sha1: "clip2222",
        durationSec: 3.1,
      },
    })

    expect(withParent.recordingId).toBe(recording.id)
    // Клипы, залитые до этой работы, живут без записи и продолжают работать.
    expect(orphan.recordingId).toBeNull()
  })

  it("пишет использованный интервал записи", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-usage",
        sha1: "usage1111",
        durationSec: 60,
        originalName: "usage.mov",
      },
    })
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const video = await prisma.video.create({ data: { scenarioId: scenario.id } })

    const usage = await prisma.presenterRecordingUsage.create({
      data: {
        recordingId: recording.id,
        startSec: 12.5,
        endSec: 17.25,
        videoId: video.id,
      },
    })

    expect(usage.usedAt).toBeInstanceOf(Date)
  })

  it("удаление записи уносит её интервалы, но не клипы", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp",
        sha1: "cccc3333",
        durationSec: 30,
        originalName: "tmp.mov",
      },
    })
    const clip = await prisma.presenterSourceClip.create({
      data: { characterId, recordingId: recording.id, fileUrl: "u", sha1: "clip3333", durationSec: 3 },
    })
    await prisma.presenterRecordingUsage.create({
      data: { recordingId: recording.id, startSec: 0, endSec: 3 },
    })

    await prisma.presenterRecording.delete({ where: { id: recording.id } })

    expect(await prisma.presenterRecordingUsage.count({ where: { recordingId: recording.id } })).toBe(0)
    // Клип переживает удаление записи: файл клипа лежит отдельно и уже
    // использован в роликах — снести его вместе с исходником значит сломать
    // историю.
    const survived = await prisma.presenterSourceClip.findUnique({ where: { id: clip.id } })
    expect(survived?.recordingId).toBeNull()
  })
})

/**
 * Фейковое хранилище для проверки `saveRecording` без сети: считает
 * заливки, отвечает на `exists`, умеет "потерять" объект (симуляция сироты
 * после обрыва между `create` и `uploadFile`).
 */
function fakeStorage() {
  const objects = new Set<string>()
  let uploadCalls = 0

  const driver: Pick<
    ReturnType<SaveRecordingDependencies["getStorageDriver"]>,
    "exists" | "uploadFile" | "providerName"
  > = {
    providerName: "mock",
    async exists(key: string) {
      return objects.has(key)
    },
    async uploadFile(key: string) {
      uploadCalls += 1
      objects.add(key)
      return { key, sizeBytes: BigInt(0) }
    },
  }

  return {
    driver,
    forget: (key: string) => objects.delete(key),
    get uploadCalls() {
      return uploadCalls
    },
  }
}

describe("сохранение записи и статус нарезки (saveRecording)", () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "presenter-recording-test-"))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  })

  // Ни одного реального ffmpeg-процесса и ни одного платного вызова: transcode
  // и storage подменены фейками через инъекцию зависимостей saveRecording.
  it("повторный saveRecording того же оригинала не создаёт вторую строку и не заливает файл второй раз", async () => {
    const originalPath = join(workDir, "original.mov")
    await writeFile(originalPath, Buffer.from("original-bytes-repeat"))
    const normalizedPath = join(workDir, "normalized.mp4")

    const storage = fakeStorage()
    let normalizeCalls = 0
    const deps: SaveRecordingDependencies = {
      sha1OfFile: async () => "repeatsha1",
      normalizeRecording: async (_input, output) => {
        normalizeCalls += 1
        await writeFile(output, Buffer.from("normalized"))
      },
      probeRecordingMeta: async () => ({ durationSec: 42, fps: 30, width: 1080, height: 1920 }),
      getStorageDriver: () => storage.driver,
    }
    const input = { appId, characterId, originalPath, normalizedPath, originalName: "rec.mov", originalBytes: 100 }

    const first = await saveRecording(input, deps)
    expect(first.deduped).toBe(false)
    expect(normalizeCalls).toBe(1)
    expect(storage.uploadCalls).toBe(1)

    const second = await saveRecording(input, deps)
    expect(second.deduped).toBe(true)
    expect(second.recordingId).toBe(first.recordingId)
    // Повторный вызов не платит второй раз: ни нормализации, ни заливки.
    expect(normalizeCalls).toBe(1)
    expect(storage.uploadCalls).toBe(1)

    expect(await prisma.presenterRecording.count({ where: { characterId } })).toBe(1)
  })

  // Регрессия на Critical 1: обрыв между `create` и `uploadFile` оставляет
  // строку без объекта — дедуп обязан это заметить и перезалить, а не
  // выдавать "готово" на несуществующий файл вечно.
  it("дедуп при отсутствующем в хранилище объекте перезаливает файл, не создавая вторую строку", async () => {
    const originalPath = join(workDir, "original.mov")
    await writeFile(originalPath, Buffer.from("original-bytes-orphan"))
    const normalizedPath = join(workDir, "normalized.mp4")

    const storage = fakeStorage()
    let normalizeCalls = 0
    const deps: SaveRecordingDependencies = {
      sha1OfFile: async () => "orphansha1",
      normalizeRecording: async (_input, output) => {
        normalizeCalls += 1
        await writeFile(output, Buffer.from("normalized"))
      },
      probeRecordingMeta: async () => ({ durationSec: 30, fps: 30, width: 1080, height: 1920 }),
      getStorageDriver: () => storage.driver,
    }
    const input = { appId, characterId, originalPath, normalizedPath, originalName: "rec.mov", originalBytes: 100 }

    const first = await saveRecording(input, deps)
    expect(storage.uploadCalls).toBe(1)

    // Симулируем сироту: объект пропал из хранилища (обрыв процесса, ручное
    // удаление, рестарт на середине многоминутной отправки).
    storage.forget(first.storageKey)

    const second = await saveRecording(input, deps)
    expect(second.recordingId).toBe(first.recordingId)
    expect(second.deduped).toBe(true)
    expect(normalizeCalls).toBe(2)
    expect(storage.uploadCalls).toBe(2)
    expect(await storage.driver.exists(first.storageKey)).toBe(true)

    // Вторая строка не завелась — почин той же самой.
    expect(await prisma.presenterRecording.count({ where: { characterId } })).toBe(1)
  })

  // Регрессия на Important 2: ffprobe при неразобранной длительности не
  // бросает, а резолвит 0 — молчаливая ложь, отравляющая запись навсегда.
  it("отказывает при неизмеримой длительности и не оставляет строку", async () => {
    const originalPath = join(workDir, "original.mov")
    await writeFile(originalPath, Buffer.from("original-bytes-zero-duration"))
    const normalizedPath = join(workDir, "normalized.mp4")

    const storage = fakeStorage()
    const deps: SaveRecordingDependencies = {
      sha1OfFile: async () => "zerodurationsha1",
      normalizeRecording: async (_input, output) => {
        await writeFile(output, Buffer.from("normalized"))
      },
      probeRecordingMeta: async () => ({ durationSec: 0, fps: null, width: null, height: null }),
      getStorageDriver: () => storage.driver,
    }
    const input = { appId, characterId, originalPath, normalizedPath, originalName: "rec.mov", originalBytes: 100 }

    await expect(saveRecording(input, deps)).rejects.toThrow(/длительность/)

    expect(storage.uploadCalls).toBe(0)
    expect(await prisma.presenterRecording.count({ where: { characterId } })).toBe(0)
  })

  it("markIngestRunning/Completed/Failed двигают статус и пишут ingestError", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-status",
        sha1: "statussha1",
        durationSec: 10,
        originalName: "status.mov",
      },
    })

    await markIngestRunning(recording.id)
    const running = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(running?.ingestStatus).toBe("running")
    expect(running?.ingestStartedAt).toBeInstanceOf(Date)
    expect(running?.ingestError).toBeNull()

    await markIngestCompleted(recording.id)
    const completed = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(completed?.ingestStatus).toBe("completed")
    expect(completed?.ingestFinishedAt).toBeInstanceOf(Date)

    const second = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-status-2",
        sha1: "statussha2",
        durationSec: 10,
        originalName: "status2.mov",
      },
    })
    await markIngestFailed(second.id, new Error("бум"))
    const failed = await prisma.presenterRecording.findUnique({ where: { id: second.id } })
    expect(failed?.ingestStatus).toBe("failed")
    expect(failed?.ingestError).toBe("бум")
    expect(failed?.ingestFinishedAt).toBeInstanceOf(Date)
  })
})
