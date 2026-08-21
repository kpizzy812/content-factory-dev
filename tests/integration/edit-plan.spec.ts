import { beforeEach, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"

// beforeEach, не beforeAll: tests/setup.ts делает TRUNCATE всех таблиц public
// в afterEach ПОСЛЕ каждого it (см. presenter-recording.spec.ts) — данные из
// beforeAll не пережили бы даже первый тест. Каждый it ниже поэтому
// самодостаточен: то, что ему нужно от App/Video, он получает заново.
let appId: number
let videoId: number

beforeEach(async () => {
  const app = await prisma.app.create({ data: { name: "edit-plan-test" } })
  appId = app.id
  const scenario = await prisma.scenario.create({ data: { status: "draft" } })
  const video = await prisma.video.create({ data: { scenarioId: scenario.id, editPipeline: true } })
  videoId = video.id
})

describe("схема монтажа", () => {
  it("хранит профиль с правилами и версией модели", async () => {
    const profile = await prisma.editProfile.create({
      data: {
        appId,
        name: "Reforma / базовый",
        editPrompt: "Чередуй крупный и средний план ведущей каждые 5 секунд.",
        llmModelId: "claude-sonnet-4-6",
      },
    })

    // Дефолты — решения от 14.08 и §5.2 спеки, а не вкус исполнителя.
    expect(profile.brollRatio).toBeCloseTo(0.4, 6)
    expect(profile.shotChangeSec).toBeCloseTo(1.8, 6)
    expect(profile.generativeVideoEnabled).toBe(false)
    expect(profile.stepwiseApproval).toBe(false)
  })

  it("ролик наследует профиль и может перебить его полем", async () => {
    const profile = await prisma.editProfile.create({
      data: { appId, name: "Reforma / базовый" },
    })

    const updated = await prisma.video.update({
      where: { id: videoId },
      data: { editProfileId: profile.id, editOverrides: { pipEnabled: true } },
    })

    expect(updated.editProfileId).toBe(profile.id)
    expect(updated.editOverrides).toMatchObject({ pipEnabled: true })
  })

  it("дедуплицирует фон по sha1 в пределах приложения", async () => {
    await prisma.backgroundClip.create({
      data: {
        appId,
        name: "Запись экрана: лид-магнит",
        storageKey: `apps/${appId}/backgrounds/aaaa1111.mp4`,
        sha1: "aaaa1111",
        kind: "screen_recording",
        durationSec: 8.4,
      },
    })

    await expect(prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: "другой ключ",
        sha1: "aaaa1111",
        kind: "screen_recording",
      },
    })).rejects.toThrow()
  })

  it("хранит кадр ролика отдельной строкой", async () => {
    const background = await prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: `apps/${appId}/backgrounds/bbbb2222.mp4`,
        sha1: "bbbb2222",
        kind: "screen_recording",
      },
    })

    const shot = await prisma.videoShot.create({
      data: {
        videoId,
        order: 0,
        startSec: 0,
        endSec: 1.8,
        sceneOrder: 1,
        foreground: "presenter",
        background: "library",
        backgroundClipId: background.id,
        idea: "Ведущая в кадре, фоном запись экрана",
      },
    })

    expect(shot.status).toBe("planned")
    expect(shot.pipEnabled).toBe(false)
    // Пара (ролик, порядок) уникальна: два кадра на одну позицию — это дыра
    // либо нахлёст в таймлайне.
    await expect(prisma.videoShot.create({
      data: { videoId, order: 0, startSec: 1.8, endSec: 3.6, foreground: "none", background: "none" },
    })).rejects.toThrow()
  })

  it("удаление фона не уносит кадры, которые его использовали", async () => {
    const background = await prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: `apps/${appId}/backgrounds/cccc3333.mp4`,
        sha1: "cccc3333",
        kind: "screen_recording",
      },
    })
    const shot = await prisma.videoShot.create({
      data: {
        videoId,
        order: 0,
        startSec: 0,
        endSec: 1.8,
        foreground: "presenter",
        background: "library",
        backgroundClipId: background.id,
      },
    })

    await prisma.backgroundClip.delete({ where: { id: background.id } })

    const reloaded = await prisma.videoShot.findUnique({ where: { id: shot.id } })
    // Кадр уже отрендерен и уехал в готовый ролик — снести его вместе с
    // исходником значит переписать историю.
    expect(reloaded).not.toBeNull()
    expect(reloaded!.backgroundClipId).toBeNull()
  })

  it("удаление ролика уносит его кадры", async () => {
    await prisma.videoShot.create({
      data: { videoId, order: 0, startSec: 0, endSec: 2, foreground: "none", background: "none" },
    })

    await prisma.video.delete({ where: { id: videoId } })

    expect(await prisma.videoShot.count({ where: { videoId } })).toBe(0)
  })
})
