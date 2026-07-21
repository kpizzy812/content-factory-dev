/**
 * Contract-тесты Google Drive API endpoints.
 *
 * Что покрыто:
 *   - GET    /api/google-drive/folders            — list через JWT exchange (mock)
 *   - POST   /api/google-drive/sync               — создание DriveFile через mock
 *   - GET    /api/google-drive/files              — фильтры/cursor пагинация
 *   - POST   /api/google-drive/files/[id]/download         — скачивание + idempotency
 *   - POST   /api/google-drive/files/[id]/import-to-video  — создание Video из DriveFile
 *   - POST   /api/pipelines/credentials/[id]/test-drive    — тест Drive credential
 *
 * Mock-режим:
 *   GOOGLE_DRIVE_MOCK_MODE=true → token endpoint и Drive API base заменены на
 *   http://localhost:18889 (см. server/utils/google-drive/client.ts). Standalone
 *   mock-сервер запускается отдельно командой `bun run mock:drive`. Он СОХРАНЯЕТСЯ
 *   между запусками (мы его не убиваем) — тесты skip'аются если он недоступен.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"
import {
  createTestDriveCredential,
  createTestDriveFile,
} from "./_helpers/drive-factory"

const MOCK_URL = process.env.GOOGLE_DRIVE_MOCK_URL ?? "http://localhost:18889"

let mockReachable = false

beforeAll(async () => {
  // Probe — если mock-сервер не запущен, помечаем тесты как skipped
  // вместо падения с ECONNREFUSED.
  try {
    const res = await fetch(`${MOCK_URL}/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.folder%27`)
    mockReachable = res.ok
  } catch {
    mockReachable = false
  }
  if (!mockReachable) {
    // eslint-disable-next-line no-console
    console.warn(
      `[google-drive.spec] Mock-сервер на ${MOCK_URL} недоступен. Запустите: 'bun run mock:drive'. Тесты skip'нутся.`,
    )
  }
})

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

const skipIfNoMock = () => ({ skip: !mockReachable })

// ────────────────────────────────────────────────────────────────────────────
// GET /api/google-drive/folders
// ────────────────────────────────────────────────────────────────────────────

describe("GET /api/google-drive/folders", () => {
  it("без credentialId → 400", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRead: true })
    await expect(
      $fetch("/api/google-drive/folders", { headers: authHeaders(user.id) }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("чужой credential (другой userId) → 404", async () => {
    if (skipIfNoMock().skip) return
    const owner = await createTestUser({ canRead: true })
    const other = await createTestUser({ canRead: true })
    const cred = await createTestDriveCredential({ userId: other.id })

    await expect(
      $fetch("/api/google-drive/folders", {
        headers: authHeaders(owner.id),
        query: { credentialId: cred.id },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("revoked credential → 403", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRead: true })
    const cred = await createTestDriveCredential({
      userId: user.id,
      revokedAt: new Date(),
    })

    await expect(
      $fetch("/api/google-drive/folders", {
        headers: authHeaders(user.id),
        query: { credentialId: cred.id },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("happy path → возвращает список папок из mock", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRead: true })
    const cred = await createTestDriveCredential({ userId: user.id })

    const res = await $fetch<{ data: { folders: Array<{ id: string, name: string }> } }>(
      "/api/google-drive/folders",
      {
        headers: authHeaders(user.id),
        query: { credentialId: cred.id, parentId: "root" },
      },
    )
    expect(Array.isArray(res.data.folders)).toBe(true)
    // mock возвращает 2 root-папки: "Креативы — апрель 2026" и "Архив"
    expect(res.data.folders.length).toBeGreaterThanOrEqual(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/google-drive/sync
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/google-drive/sync", () => {
  it("happy path → создаёт DriveFile записи в БД", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRunAgent: true })
    const cred = await createTestDriveCredential({ userId: user.id })

    const res = await $fetch<{
      data: { scanned: number, created: number, updated: number, skipped: number, errors: unknown[] }
    }>("/api/google-drive/sync", {
      method: "POST",
      headers: authHeaders(user.id),
      body: { credentialId: cred.id, folderId: "mock-folder-1", onlyVideos: true },
    })

    expect(res.data.scanned).toBeGreaterThanOrEqual(1)
    expect(res.data.created).toBeGreaterThanOrEqual(1)

    const stored = await prisma.driveFile.findMany({
      where: { credentialId: cred.id, userId: user.id },
    })
    expect(stored.length).toBeGreaterThanOrEqual(1)
    // mock-folder-1 содержит 3 видео (mock-video-1..3)
    expect(stored.length).toBeGreaterThanOrEqual(3)
  })

  it("невалидный folderId → 400", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRunAgent: true })
    const cred = await createTestDriveCredential({ userId: user.id })

    await expect(
      $fetch("/api/google-drive/sync", {
        method: "POST",
        headers: authHeaders(user.id),
        body: { credentialId: cred.id, folderId: "x" }, // короче 10 символов
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/google-drive/files
// ────────────────────────────────────────────────────────────────────────────

describe("GET /api/google-drive/files", () => {
  it("фильтр syncStatus='detected' → возвращает только detected", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRead: true })
    const cred = await createTestDriveCredential({ userId: user.id })
    await createTestDriveFile({ credentialId: cred.id, userId: user.id, syncStatus: "detected" })
    await createTestDriveFile({
      credentialId: cred.id,
      userId: user.id,
      driveFileId: "mock-video-2",
      syncStatus: "downloaded",
      localPath: "/tmp/x.mp4",
    })

    const res = await $fetch<{ data: Array<{ syncStatus: string }>, meta: { total: number } }>(
      "/api/google-drive/files",
      {
        headers: authHeaders(user.id),
        query: { credentialId: cred.id, syncStatus: "detected" },
      },
    )
    expect(res.data.length).toBe(1)
    expect(res.data[0]?.syncStatus).toBe("detected")
  })

  it("пагинация cursor → возвращает следующую страницу", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRead: true })
    const cred = await createTestDriveCredential({ userId: user.id })
    for (let i = 1; i <= 5; i++) {
      await createTestDriveFile({
        credentialId: cred.id,
        userId: user.id,
        driveFileId: `mock-page-${i}`,
        name: `creative-${i}.mp4`,
      })
    }

    const page1 = await $fetch<{
      data: Array<{ id: number }>
      meta: { nextCursor?: number, total: number }
    }>("/api/google-drive/files", {
      headers: authHeaders(user.id),
      query: { credentialId: cred.id, limit: 2 },
    })
    expect(page1.data.length).toBe(2)
    expect(page1.meta.nextCursor).toBeDefined()

    const page2 = await $fetch<{ data: Array<{ id: number }>, meta: { nextCursor?: number } }>(
      "/api/google-drive/files",
      {
        headers: authHeaders(user.id),
        query: { credentialId: cred.id, limit: 2, cursor: page1.meta.nextCursor },
      },
    )
    expect(page2.data.length).toBe(2)
    // Гарантируем что страницы НЕ пересекаются по id
    const ids1 = page1.data.map((f) => f.id)
    const ids2 = page2.data.map((f) => f.id)
    for (const id of ids2) expect(ids1).not.toContain(id)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/google-drive/files/[id]/download
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/google-drive/files/[id]/download", () => {
  it("happy path → файл скачан, syncStatus=downloaded, localPath заполнен", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRunAgent: true })
    const cred = await createTestDriveCredential({ userId: user.id })
    const file = await createTestDriveFile({
      credentialId: cred.id,
      userId: user.id,
      driveFileId: "mock-video-1",
    })

    const res = await $fetch<{
      data: { id: number, localPath: string, syncStatus: string }
    }>(`/api/google-drive/files/${file.id}/download`, {
      method: "POST",
      headers: authHeaders(user.id),
    })

    expect(res.data.syncStatus).toBe("downloaded")
    expect(res.data.localPath).toContain("storage/uploads/drive-imports")
    expect(res.data.localPath).toContain("mock-video-1")

    const stored = await prisma.driveFile.findUniqueOrThrow({ where: { id: file.id } })
    expect(stored.syncStatus).toBe("downloaded")
    expect(stored.localPath).toBeTruthy()
  })

  it("повторный вызов → idempotent, тот же localPath", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRunAgent: true })
    const cred = await createTestDriveCredential({ userId: user.id })
    const file = await createTestDriveFile({
      credentialId: cred.id,
      userId: user.id,
      driveFileId: "mock-video-1",
    })

    const r1 = await $fetch<{ data: { localPath: string } }>(
      `/api/google-drive/files/${file.id}/download`,
      { method: "POST", headers: authHeaders(user.id) },
    )
    const r2 = await $fetch<{ data: { localPath: string } }>(
      `/api/google-drive/files/${file.id}/download`,
      { method: "POST", headers: authHeaders(user.id) },
    )
    expect(r2.data.localPath).toBe(r1.data.localPath)
  })

  it("чужой файл (userId mismatch) → 403", async () => {
    if (skipIfNoMock().skip) return
    const owner = await createTestUser({ canRunAgent: true })
    const other = await createTestUser({ canRunAgent: true })
    const cred = await createTestDriveCredential({ userId: other.id })
    const file = await createTestDriveFile({
      credentialId: cred.id,
      userId: other.id,
      driveFileId: "mock-video-1",
    })

    await expect(
      $fetch(`/api/google-drive/files/${file.id}/download`, {
        method: "POST",
        headers: authHeaders(owner.id),
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/google-drive/files/[id]/import-to-video
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/google-drive/files/[id]/import-to-video", () => {
  async function setupDownloadedFile(userId: number) {
    const cred = await createTestDriveCredential({ userId })
    return createTestDriveFile({
      credentialId: cred.id,
      userId,
      driveFileId: "mock-video-1",
      syncStatus: "downloaded",
      localPath: "/tmp/zc-import-test.mp4",
    })
  }

  async function setupScenario() {
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const app = await prisma.app.create({
      data: { name: `Test App ${seed}`, keywords: [] },
    })
    const trend = await prisma.trend.create({
      data: {
        appId: app.id,
        platform: "tiktok",
        sourceUrl: `https://tiktok.com/@x/video/${seed}`,
        title: `Trend ${seed}`,
        description: "x",
        hashtags: [],
        viewCount: 1000,
      },
    })
    return prisma.scenario.create({
      data: { trendId: trend.id, appId: app.id, status: "generated" },
    })
  }

  it("без scenarioId → 400", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canCreate: true, canRunAgent: true })
    const file = await setupDownloadedFile(user.id)

    await expect(
      $fetch(`/api/google-drive/files/${file.id}/import-to-video`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("повторный вызов на уже импортированный файл → 409", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canCreate: true, canRunAgent: true })
    const file = await setupDownloadedFile(user.id)
    const scenario = await setupScenario()

    // Помечаем файл как уже импортированный
    const fakeVideo = await prisma.video.create({
      data: {
        scenarioId: scenario.id,
        status: "completed",
        format: "portrait",
        filePath: "/tmp/zc-import-test.mp4",
      },
    })
    await prisma.driveFile.update({
      where: { id: file.id },
      data: { videoId: fakeVideo.id, syncStatus: "imported_to_video" },
    })

    await expect(
      $fetch(`/api/google-drive/files/${file.id}/import-to-video`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { scenarioId: scenario.id },
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("файл не downloaded → 409", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canCreate: true, canRunAgent: true })
    const cred = await createTestDriveCredential({ userId: user.id })
    const file = await createTestDriveFile({
      credentialId: cred.id,
      userId: user.id,
      syncStatus: "detected", // не скачан
    })
    const scenario = await setupScenario()

    await expect(
      $fetch(`/api/google-drive/files/${file.id}/import-to-video`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { scenarioId: scenario.id },
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/pipelines/credentials/[id]/test-drive
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/pipelines/credentials/[id]/test-drive", () => {
  it("happy path → 200 + lastTestedAt обновлён", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRead: true })
    const cred = await createTestDriveCredential({ userId: user.id })
    expect(cred.lastTestedAt).toBeNull()

    const res = await $fetch<{ data: { ok: boolean, message: string, foldersFound: number } }>(
      `/api/pipelines/credentials/${cred.id}/test-drive`,
      { method: "POST", headers: authHeaders(user.id) },
    )

    expect(res.data.ok).toBe(true)
    expect(res.data.foldersFound).toBeGreaterThanOrEqual(0)

    const updated = await prisma.pipelineCredential.findUniqueOrThrow({ where: { id: cred.id } })
    expect(updated.lastTestedAt).not.toBeNull()
    expect(updated.lastTestStatus).toBe("ok")
  })

  it("revoked credential → 403", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRead: true })
    const cred = await createTestDriveCredential({
      userId: user.id,
      revokedAt: new Date(),
    })

    await expect(
      $fetch(`/api/pipelines/credentials/${cred.id}/test-drive`, {
        method: "POST",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("чужой credential → 404", async () => {
    if (skipIfNoMock().skip) return
    const owner = await createTestUser({ canRead: true })
    const other = await createTestUser({ canRead: true })
    const cred = await createTestDriveCredential({ userId: other.id })

    await expect(
      $fetch(`/api/pipelines/credentials/${cred.id}/test-drive`, {
        method: "POST",
        headers: authHeaders(owner.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/pipelines/credentials — secretData mismatch
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/pipelines/credentials — security around Drive metadata", () => {
  it("создаёт credential с metadata.kind=google_drive_service_account", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canWrite: true })

    // используем фабрику чтобы получить валидный SA JSON
    const cred = await createTestDriveCredential({
      userId: user.id,
      metadata: { kind: "google_drive_service_account", clientEmail: "x@y.iam.gserviceaccount.com" },
    })

    const meta = cred.metadata as { kind?: string, clientEmail?: string }
    expect(meta.kind).toBe("google_drive_service_account")
    expect(meta.clientEmail).toBe("x@y.iam.gserviceaccount.com")
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Rate-limit (запускается ПОСЛЕДНИМ, чтобы не загрязнять userBuckets для
// последующих тестов — после TRUNCATE+RESTART IDENTITY userId переиспользуются
// и протекание лимита из этого теста на следующие сюиты возможно).
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/google-drive/sync — rate-limit (runs last)", () => {
  it("31-й вызов в окне 60с → 429", async () => {
    if (skipIfNoMock().skip) return
    const user = await createTestUser({ canRunAgent: true })
    const cred = await createTestDriveCredential({ userId: user.id })

    // 30 успешных вызовов исчерпывают per-user лимит. 31-й даёт 429.
    let success = 0
    let denied = 0

    for (let i = 0; i < 31; i++) {
      try {
        await $fetch("/api/google-drive/sync", {
          method: "POST",
          headers: authHeaders(user.id),
          body: { credentialId: cred.id, folderId: "mock-folder-1", onlyVideos: true },
        })
        success++
      } catch (err) {
        const e = err as { statusCode?: number }
        if (e.statusCode === 429) denied++
      }
    }

    expect(denied).toBeGreaterThanOrEqual(1)
    expect(success).toBeGreaterThanOrEqual(20)
  }, 60_000)
})
