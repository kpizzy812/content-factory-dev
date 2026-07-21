/**
 * Integration-тесты: блок создания api-постинг-джоб для IG/TikTok.
 *
 * Реального API-раннера нет (IG/TikTok постят только через browser_automation).
 * Раньше такая джоба молча фейкала «Опубликовано» с mock-post URL — теперь
 * создание отклоняется дружелюбной 422 (single) / per-pair skip (bulk).
 *
 * YouTube api НЕ блокируется (вне нашего решения).
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
import { createTestVideoWithScenario } from "./_helpers/video-factory"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

async function createTestVideo(appId: number) {
  const bundle = await createTestVideoWithScenario({ appId })
  return bundle.video
}

async function healthyProxy(createdById: number) {
  const proxy = await createTestProxy({ expectedCountry: "US", createdById })
  await prisma.proxy.update({ where: { id: proxy.id }, data: { status: "healthy" } })
  return proxy
}

describe("POST /api/posting-jobs — блок api-метода для IG/TikTok", () => {
  it("instagram + postingMethod=api → 422 api_method_unsupported", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const video = await createTestVideo(app.id)
    const proxy = await healthyProxy(user.id)
    const acc = await createTestSocialAccount({
      appId: app.id,
      platform: "instagram",
      proxyId: proxy.id,
      postingMethod: "api",
      displayName: "IG api acc",
    })

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: acc.id,
          platform: "instagram",
          contentSnapshot: { caption: "test" },
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      data: { data: { code: "api_method_unsupported", accountId: acc.id } },
    })
  })

  it("tiktok + postingMethod=api → 422 api_method_unsupported", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const video = await createTestVideo(app.id)
    const proxy = await healthyProxy(user.id)
    const acc = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      proxyId: proxy.id,
      postingMethod: "api",
    })

    await expect(
      $fetch("/api/posting-jobs", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: acc.id,
          platform: "tiktok",
          contentSnapshot: { caption: "test" },
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      data: { data: { code: "api_method_unsupported" } },
    })
  })

  it("instagram + browser_automation → создаёт job (метод валиден)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const video = await createTestVideo(app.id)
    const proxy = await healthyProxy(user.id)
    const acc = await createTestSocialAccount({
      appId: app.id,
      platform: "instagram",
      proxyId: proxy.id,
      postingMethod: "browser_automation",
    })

    const res = await $fetch<{ data: { id: string; status: string } }>(
      "/api/posting-jobs",
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          videoId: video.id,
          socialAccountId: acc.id,
          platform: "instagram",
          contentSnapshot: { caption: "test" },
        },
      },
    )
    expect(res.data.id).toBeTruthy()
  })

  it("youtube + postingMethod=api → НЕ блокируется (вне решения)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const video = await createTestVideo(app.id)
    const proxy = await healthyProxy(user.id)
    const acc = await createTestSocialAccount({
      appId: app.id,
      platform: "youtube",
      proxyId: proxy.id,
      postingMethod: "api",
    })

    const res = await $fetch<{ data: { id: string } }>("/api/posting-jobs", {
      method: "POST",
      headers: authHeaders(user.id),
      body: {
        videoId: video.id,
        socialAccountId: acc.id,
        platform: "youtube",
        contentSnapshot: {
          title: "yt title",
          youtube: { visibility: "private", madeForKids: false },
        },
      },
    })
    expect(res.data.id).toBeTruthy()
  })
})

describe("POST /api/posting-jobs/bulk — per-pair skip api-метода для IG", () => {
  it("instagram api пара уходит в skip api_method_unsupported, browser_automation пара создаётся", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const videoA = await createTestVideo(app.id)
    const videoB = await createTestVideo(app.id)
    const proxyApi = await healthyProxy(user.id)
    const proxyBa = await healthyProxy(user.id)

    const accApi = await createTestSocialAccount({
      appId: app.id,
      platform: "instagram",
      proxyId: proxyApi.id,
      postingMethod: "api",
      displayName: "IG api acc",
    })
    const accBa = await createTestSocialAccount({
      appId: app.id,
      platform: "instagram",
      proxyId: proxyBa.id,
      postingMethod: "browser_automation",
      displayName: "IG browser acc",
    })

    const now = Date.now()
    const windowStart = new Date(now + 60_000).toISOString()
    const windowEnd = new Date(now + 24 * 60 * 60_000).toISOString()
    const snapshot = { caption: "hi" }

    const res = await $fetch<{
      data: {
        created: { id: string }[]
        skipped: { socialAccountId: number; code: string }[]
      }
    }>("/api/posting-jobs/bulk", {
      method: "POST",
      headers: authHeaders(user.id),
      body: {
        platform: "instagram",
        windowStart,
        windowEnd,
        pairs: [
          {
            socialAccountId: accApi.id,
            videoId: videoA.id,
            scheduledAt: new Date(now + 2 * 60 * 60_000).toISOString(),
            contentSnapshot: snapshot,
          },
          {
            socialAccountId: accBa.id,
            videoId: videoB.id,
            scheduledAt: new Date(now + 2 * 60 * 60_000).toISOString(),
            contentSnapshot: snapshot,
          },
        ],
      },
    })

    expect(res.data.created.length).toBe(1)
    expect(res.data.skipped.length).toBe(1)
    expect(res.data.skipped[0]).toMatchObject({
      socialAccountId: accApi.id,
      code: "api_method_unsupported",
    })
  })
})
