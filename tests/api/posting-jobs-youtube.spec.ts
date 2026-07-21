/**
 * Integration-тесты YouTube-специфичной валидации snapshot на POST /api/posting-jobs.
 *
 * Бэкенд для youtube platform требует structured contentSnapshot:
 *   - title (1..100)
 *   - description? ≤5000
 *   - hashtags? string[] ≤500 chars суммарно
 *   - youtube.visibility ∈ {public,unlisted,private}
 *   - youtube.madeForKids: boolean
 *
 * Никаких дефолтов — fail-safe для постинг-фермы.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import {
  createTestApp,
  createTestProxy,
  createTestSocialAccount,
} from "../helpers/factories"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

async function createTestVideo(appId: number) {
  return prisma.video.create({
    data: {
      appId,
      title: "test youtube video",
      status: "ready",
    },
  })
}

async function setupYoutubeFixtures(userId: number) {
  const app = await createTestApp()
  const video = await createTestVideo(app.id)
  const proxy = await createTestProxy({ createdById: userId })
  await prisma.proxy.update({
    where: { id: proxy.id },
    data: { status: "healthy" },
  })
  const account = await createTestSocialAccount({
    appId: app.id,
    platform: "youtube",
    proxyId: proxy.id,
  })
  return { app, video, account }
}

function validYoutubeSnapshot() {
  return {
    title: "Test YouTube Video",
    description: "Some description here",
    hashtags: ["shorts", "fitness"],
    youtube: { visibility: "private", madeForKids: false },
  }
}

describe("POST /api/posting-jobs — YouTube snapshot валидация (fail-safe)", () => {
  it("валидный YouTube snapshot → 201 создан", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    const res = await $fetch<{ data: { id: string; status: string } }>(
      "/api/posting-jobs",
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: validYoutubeSnapshot(),
        },
      },
    )
    expect(res.data.id).toBeTruthy()
    expect(["queued", "scheduled"]).toContain(res.data.status)
  })

  it("title отсутствует → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)
    const snap = validYoutubeSnapshot()
    delete (snap as { title?: string }).title

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: snap,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("title пустая строка → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: { ...validYoutubeSnapshot(), title: "   " },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("title >100 chars → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: { ...validYoutubeSnapshot(), title: "x".repeat(101) },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("description >5000 chars → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: {
            ...validYoutubeSnapshot(),
            description: "x".repeat(5001),
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("hashtags не массив → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: {
            ...validYoutubeSnapshot(),
            hashtags: "fitness,shorts",
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("hashtags суммарно >500 chars → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: {
            ...validYoutubeSnapshot(),
            hashtags: ["x".repeat(501)],
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("youtube object отсутствует → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)
    const snap = validYoutubeSnapshot()
    delete (snap as { youtube?: unknown }).youtube

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: snap,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("visibility отсутствует → 400 (НЕТ ДЕФОЛТА — fail-safe)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: {
            ...validYoutubeSnapshot(),
            youtube: { madeForKids: false },
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("visibility не из enum → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: {
            ...validYoutubeSnapshot(),
            youtube: { visibility: "secret", madeForKids: false },
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("madeForKids отсутствует → 400 (НЕТ ДЕФОЛТА — YouTube требует выбор)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: {
            ...validYoutubeSnapshot(),
            youtube: { visibility: "private" },
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("madeForKids не boolean → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: {
            ...validYoutubeSnapshot(),
            youtube: { visibility: "private", madeForKids: "false" },
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("proxy unhealthy → 412 (proxy gating срабатывает после snapshot валидации)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const video = await createTestVideo(app.id)
    const proxy = await createTestProxy({ createdById: user.id })
    await prisma.proxy.update({
      where: { id: proxy.id },
      data: { status: "dead" },
    })
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "youtube",
      proxyId: proxy.id,
    })

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: validYoutubeSnapshot(),
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 412,
      data: { data: { code: "proxy_unhealthy" } },
    })
  })

  it("valid public visibility → 201 создан (warning UX, но не блокирует)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { video, account } = await setupYoutubeFixtures(user.id)

    const res = await $fetch<{ data: { id: string } }>(
      "/api/posting-jobs",
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: account.id,
          platform: "youtube",
          contentSnapshot: {
            ...validYoutubeSnapshot(),
            youtube: { visibility: "public", madeForKids: false },
          },
        },
      },
    )
    expect(res.data.id).toBeTruthy()
  })
})
