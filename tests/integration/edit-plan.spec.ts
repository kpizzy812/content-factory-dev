import { beforeEach, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"
import { StorageKeys } from "~~/server/utils/storage/keys"

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

    // Правила и версия модели — то, что обещает название теста, а не только дефолты.
    expect(profile.editPrompt).toBe("Чередуй крупный и средний план ведущей каждые 5 секунд.")
    expect(profile.llmModelId).toBe("claude-sonnet-4-6")

    // Дефолты — решения от 14.08 и §5.2 спеки, а не вкус исполнителя.
    expect(profile.brollRatio).toBeCloseTo(0.4, 6)
    expect(profile.shotChangeSec).toBeCloseTo(1.8, 6)
    expect(profile.generativeVideoEnabled).toBe(false)
    expect(profile.stepwiseApproval).toBe(false)
    expect(profile.pipPosition).toBe("bottom_right")
    expect(profile.pipSize).toBeCloseTo(0.28, 6)
    expect(profile.generativeVideoBudgetUsd).toBeCloseTo(0.5, 6)
    // Формат Kling (потребитель поля — генеративный фон кадра), не аватарной
    // speech_to_video модели: см. фикс-раунд 2 ревью Task 2.
    expect(profile.generativeVideoResolution).toBe("1080x1920")
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
        storageKey: StorageKeys.backgroundClip(appId, "aaaa1111"),
        sha1: "aaaa1111",
        kind: "screen_recording",
        durationSec: 8.4,
      },
    })

    // P2002, а не просто throw: следующая задача может добавить обязательную
    // колонку без дефолта — тогда create упадёт на валидации входа, а не на
    // @@unique([appId, sha1]), и тест останется зелёным по неверной причине.
    await expect(prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: "другой ключ",
        sha1: "aaaa1111",
        kind: "screen_recording",
      },
    })).rejects.toMatchObject({ code: "P2002" })
  })

  it("хранит кадр ролика отдельной строкой", async () => {
    const background = await prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: StorageKeys.backgroundClip(appId, "bbbb2222"),
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
    })).rejects.toMatchObject({ code: "P2002" })
  })

  it("удаление фона не уносит кадры, которые его использовали", async () => {
    const background = await prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: StorageKeys.backgroundClip(appId, "cccc3333"),
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

  it("удаление приложения не уносит монтажный профиль — обнуляет appId", async () => {
    const profile = await prisma.editProfile.create({
      data: { appId, name: "Reforma / базовый" },
    })

    await prisma.app.delete({ where: { id: appId } })

    const reloaded = await prisma.editProfile.findUnique({ where: { id: profile.id } })
    expect(reloaded).not.toBeNull()
    expect(reloaded!.appId).toBeNull()
  })

  it("удаление приложения уносит фоны, но не кадры, которые их использовали", async () => {
    const background = await prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: StorageKeys.backgroundClip(appId, "dddd4444"),
        sha1: "dddd4444",
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

    await prisma.app.delete({ where: { id: appId } })

    // Библиотека фонов принадлежит приложению целиком — удаление приложения
    // уносит её каскадом.
    expect(await prisma.backgroundClip.findUnique({ where: { id: background.id } })).toBeNull()
    // А кадр, который фон уже использовал, выживает с backgroundClipId = null —
    // тот же принцип, что и при прямом удалении одного фона.
    const reloadedShot = await prisma.videoShot.findUnique({ where: { id: shot.id } })
    expect(reloadedShot).not.toBeNull()
    expect(reloadedShot!.backgroundClipId).toBeNull()
  })

  it("удаление монтажного профиля не уносит ролик — обнуляет editProfileId", async () => {
    const profile = await prisma.editProfile.create({
      data: { appId, name: "Reforma / базовый" },
    })
    await prisma.video.update({ where: { id: videoId }, data: { editProfileId: profile.id } })

    await prisma.editProfile.delete({ where: { id: profile.id } })

    const reloaded = await prisma.video.findUnique({ where: { id: videoId } })
    expect(reloaded).not.toBeNull()
    expect(reloaded!.editProfileId).toBeNull()
  })

  it("удаление скрина приложения не уносит кадр, который его использовал", async () => {
    const reference = await prisma.appReferenceImage.create({
      data: {
        appId,
        fileUrl: `https://example.test/api/files/app-references/${appId}/eeee5555.png`,
        sha1: "eeee5555",
      },
    })
    const shot = await prisma.videoShot.create({
      data: {
        videoId,
        order: 0,
        startSec: 0,
        endSec: 1.8,
        foreground: "presenter",
        background: "app_screen",
        appReferenceId: reference.id,
      },
    })

    await prisma.appReferenceImage.delete({ where: { id: reference.id } })

    // Тот же принцип, что и у backgroundClipId: у скрина свой жизненный цикл,
    // отрендеренный кадр его не должен терять при удалении исходника.
    const reloaded = await prisma.videoShot.findUnique({ where: { id: shot.id } })
    expect(reloaded).not.toBeNull()
    expect(reloaded!.appReferenceId).toBeNull()
  })
})
