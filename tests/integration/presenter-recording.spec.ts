import { beforeEach, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"

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
