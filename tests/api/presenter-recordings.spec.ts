/**
 * Contract-тесты HTTP-слоя записей ведущего (долг плана A, пункт 4).
 *
 * Три эндпоинта не были исполнены НИ ОДНИМ тестом через настоящий
 * defineEventHandler — не проверены ветки 404/409/400 и проверка
 * принадлежности записи персонажу (контроль доступа без автотеста — это
 * декларация в комментарии, а не защита):
 *
 *   GET  /api/characters/:id/recordings
 *   POST /api/characters/:id/recordings/:recordingId/reingest
 *   PUT  /api/characters/:id/recordings/:recordingId/retention
 *
 * Настоящий Nitro, настоящая тестовая БД. Все нужные ветки воспроизводятся
 * БЕЗ ffmpeg — happy-path перенарезки (POST reingest) сюда не входит: он
 * требует ffmpeg и уже покрыт в tests/integration/presenter-recording.spec.ts.
 *
 * Образцы: tests/api/characters-regenerate.spec.ts, tests/api/_template.spec.ts.example.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

async function createTestCharacter() {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: { name: `Presenter Recordings Test App ${seed}`, description: "test", keywords: ["test"] },
  })
  const character = await prisma.character.create({
    data: { appId: app.id, name: `Ведущая ${seed}` },
  })
  return { app, character }
}

async function createTestRecording(characterId: string, overrides: Record<string, unknown> = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.presenterRecording.create({
    data: {
      characterId,
      storageKey: `tmp-contract-${seed}`,
      sha1: `contractsha1${seed}`.slice(0, 16),
      durationSec: 30,
      originalName: "recording.mp4",
      ingestStatus: "completed",
      ...overrides,
    },
  })
}

describe("GET /api/characters/:id/recordings", () => {
  it("200 со списком записей: activeClipCount считает только isActive: true, bytes/totalBytes сериализуются строкой (BigInt)", async () => {
    const user = await createTestUser()
    const { character } = await createTestCharacter()

    // Больше потолка INTEGER (2 147 483 647) — регрессия BigInt->number молча
    // теряет точность выше 2^53, а раньше здесь было переполнение уже на границе
    // MAX_FILE_BYTES (Minor 3 финального ревью).
    const bigBytes = 5_000_000_000n
    const recording = await createTestRecording(character.id, { bytes: bigBytes })

    await prisma.presenterSourceClip.create({
      data: {
        characterId: character.id, recordingId: recording.id,
        fileUrl: "https://cdn/active.mp4", sha1: "clip-active-0001", durationSec: 4, isActive: true,
      },
    })
    await prisma.presenterSourceClip.create({
      data: {
        characterId: character.id, recordingId: recording.id,
        fileUrl: "https://cdn/inactive.mp4", sha1: "clip-inactive-01", durationSec: 4, isActive: false,
      },
    })

    const res = await $fetch<{ data: { recordings: Array<Record<string, unknown>>, totalBytes: unknown } }>(
      `/api/characters/${character.id}/recordings`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.recordings).toHaveLength(1)
    const row = res.data.recordings[0]!
    expect(row).toMatchObject({
      id: recording.id,
      originalName: "recording.mp4",
      durationSec: 30,
      retention: "auto",
      ingestStatus: "completed",
      ingestError: null,
      // Ровно один активный клип — второй (isActive: false) не должен считаться.
      activeClipCount: 1,
    })
    expect(row.createdAt).toBeDefined()
    expect(row.bytes).toBe("5000000000")
    expect(typeof row.bytes).toBe("string")
    expect(res.data.totalBytes).toBe("5000000000")
    expect(typeof res.data.totalBytes).toBe("string")
  })

  it("404 на несуществующего персонажа", async () => {
    const user = await createTestUser()
    await expect(
      $fetch("/api/characters/00000000-0000-0000-0000-000000000000/recordings", {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("401 без auth", async () => {
    const { character } = await createTestCharacter()
    await expect($fetch(`/api/characters/${character.id}/recordings`)).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe("PUT /api/characters/:id/recordings/:recordingId/retention", () => {
  it("200 на keep — значение реально меняется в БД", async () => {
    const user = await createTestUser()
    const { character } = await createTestCharacter()
    const recording = await createTestRecording(character.id)

    const res = await $fetch<{ data: { retention: string } }>(
      `/api/characters/${character.id}/recordings/${recording.id}/retention`,
      { method: "PUT", headers: authHeaders(user.id), body: { retention: "keep" } },
    )
    expect(res.data.retention).toBe("keep")

    const refreshed = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(refreshed?.retention).toBe("keep")
  })

  it("200 на auto — значение реально меняется в БД", async () => {
    const user = await createTestUser()
    const { character } = await createTestCharacter()
    const recording = await createTestRecording(character.id, { retention: "keep" })

    const res = await $fetch<{ data: { retention: string } }>(
      `/api/characters/${character.id}/recordings/${recording.id}/retention`,
      { method: "PUT", headers: authHeaders(user.id), body: { retention: "auto" } },
    )
    expect(res.data.retention).toBe("auto")

    const refreshed = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(refreshed?.retention).toBe("auto")
  })

  it("400 на retention: \"нет-такого\"", async () => {
    const user = await createTestUser()
    const { character } = await createTestCharacter()
    const recording = await createTestRecording(character.id)

    await expect(
      $fetch(`/api/characters/${character.id}/recordings/${recording.id}/retention`, {
        method: "PUT", headers: authHeaders(user.id), body: { retention: "нет-такого" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 на пустое тело", async () => {
    const user = await createTestUser()
    const { character } = await createTestCharacter()
    const recording = await createTestRecording(character.id)

    await expect(
      $fetch(`/api/characters/${character.id}/recordings/${recording.id}/retention`, {
        method: "PUT", headers: authHeaders(user.id), body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 на несуществующего персонажа", async () => {
    const user = await createTestUser()
    const { character } = await createTestCharacter()
    const recording = await createTestRecording(character.id)

    await expect(
      $fetch(`/api/characters/00000000-0000-0000-0000-000000000000/recordings/${recording.id}/retention`, {
        method: "PUT", headers: authHeaders(user.id), body: { retention: "keep" },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("404 на запись ЧУЖОГО персонажа — чужая запись не изменяется", async () => {
    const user = await createTestUser()
    const { character: owner } = await createTestCharacter()
    const { character: intruder } = await createTestCharacter()
    const recording = await createTestRecording(owner.id, { retention: "auto" })

    await expect(
      $fetch(`/api/characters/${intruder.id}/recordings/${recording.id}/retention`, {
        method: "PUT", headers: authHeaders(user.id), body: { retention: "keep" },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })

    const untouched = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(untouched?.retention).toBe("auto")
  })

  it("401 без auth", async () => {
    const { character } = await createTestCharacter()
    const recording = await createTestRecording(character.id)

    await expect(
      $fetch(`/api/characters/${character.id}/recordings/${recording.id}/retention`, {
        method: "PUT", body: { retention: "keep" },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe("POST /api/characters/:id/recordings/:recordingId/reingest", () => {
  it("409, когда нарезка уже идёт", async () => {
    const user = await createTestUser()
    const { character } = await createTestCharacter()
    // ingestStartedAt свежий — проходит порог STALE_RUNNING_THRESHOLD_MS
    // (server/utils/presenter/recording-store.ts), т.е. считается ЖИВОЙ работой,
    // а не зависшим прогоном.
    const recording = await createTestRecording(character.id, {
      ingestStatus: "running",
      ingestStartedAt: new Date(),
    })

    await expect(
      $fetch(`/api/characters/${character.id}/recordings/${recording.id}/reingest`, {
        method: "POST", headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("404 на запись чужого персонажа", async () => {
    const user = await createTestUser()
    const { character: owner } = await createTestCharacter()
    const { character: intruder } = await createTestCharacter()
    const recording = await createTestRecording(owner.id)

    await expect(
      $fetch(`/api/characters/${intruder.id}/recordings/${recording.id}/reingest`, {
        method: "POST", headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("404 на несуществующего персонажа", async () => {
    const user = await createTestUser()
    const { character } = await createTestCharacter()
    const recording = await createTestRecording(character.id)

    await expect(
      $fetch(`/api/characters/00000000-0000-0000-0000-000000000000/recordings/${recording.id}/reingest`, {
        method: "POST", headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("401 без auth", async () => {
    const { character } = await createTestCharacter()
    const recording = await createTestRecording(character.id)

    await expect(
      $fetch(`/api/characters/${character.id}/recordings/${recording.id}/reingest`, { method: "POST" }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
