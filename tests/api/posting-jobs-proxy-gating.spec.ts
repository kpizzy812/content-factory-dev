/**
 * Integration-тесты proxy gating на POST /api/posting-jobs.
 *
 * 1:1:1 защита: нельзя создать posting job если у аккаунта:
 *   - нет proxyId → 412 no_proxy
 *   - proxy.status !== healthy → 412 proxy_unhealthy
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

// Зоны device-автоматизации и прокси выключены по умолчанию — этот suite их проверяет.
await setup({
  dev: true,
  server: true,
  browser: false,
  env: {
    ...nuxtTestEnv,
    LEGACY_DEVICE_AUTOMATION_ENABLED: "true",
    LEGACY_PROXY_POOL_ENABLED: "true",
  },
})

async function createTestVideo(appId: number) {
  // Video.create требует обязательную привязку к Scenario (схема изменилась).
  // Используем полную фабрику App→Trend→Scenario→Video.
  const bundle = await createTestVideoWithScenario({ appId })
  return bundle.video
}

describe("POST /api/posting-jobs proxy gating", () => {
  it("аккаунт без proxy → 412 no_proxy", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const video = await createTestVideo(app.id)
    const acc = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      proxyId: null,
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
      statusCode: 412,
      data: { data: { code: "no_proxy", accountId: acc.id } },
    })
  })

  it("аккаунт с unhealthy proxy → 412 proxy_unhealthy", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const video = await createTestVideo(app.id)
    const proxy = await createTestProxy({
      expectedCountry: "US",
      createdById: user.id,
    })
    await prisma.proxy.update({
      where: { id: proxy.id },
      data: { status: "dead" },
    })
    const acc = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      proxyId: proxy.id,
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
      statusCode: 412,
      data: {
        data: {
          code: "proxy_unhealthy",
          proxyStatus: "dead",
        },
      },
    })
  })

  it("аккаунт с healthy proxy → создаёт job", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const video = await createTestVideo(app.id)
    const proxy = await createTestProxy({
      expectedCountry: "US",
      createdById: user.id,
    })
    await prisma.proxy.update({
      where: { id: proxy.id },
      data: { status: "healthy" },
    })
    const acc = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      proxyId: proxy.id,
      // tiktok api теперь блокируется (нет реального API-раннера) — для happy-path
      // создания используем browser_automation, единственный валидный метод.
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
          platform: "tiktok",
          contentSnapshot: { caption: "test" },
        },
      },
    )
    expect(res.data.id).toBeTruthy()
    expect(["queued", "scheduled"]).toContain(res.data.status)
  })
})
