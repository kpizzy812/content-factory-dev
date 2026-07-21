/**
 * Тесты ручного создания SocialAccount (без OAuth).
 *
 * Покрытие:
 *   1. POST /api/accounts без accessToken → 200, accessToken=null в БД,
 *      platformHandle сохранён с нормализацией "@".
 *   2. POST /api/accounts с accessToken → 200, accessToken зашифрован
 *      (формат iv:authTag:ciphertext), не plaintext.
 *   3. Валидация: пустой displayName → 400, невалидный platform → 400.
 *   4. OAuth endpoints отключены — connect/callback возвращают 410.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { createTestApp } from "../helpers/factories"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

interface CreateResponse {
  data: {
    id: number
    appId: number
    platform: string
    displayName: string
    platformHandle: string | null
    status: string
    createdAt: string
  }
  error: null
}

describe("POST /api/accounts — manual creation", () => {
  it("создаёт аккаунт без accessToken (manual, для Indigo automation)", async () => {
    const user = await createTestUser({ canCreate: true })
    const app = await createTestApp()

    const res = await $fetch<CreateResponse>("/api/accounts", {
      method: "POST",
      body: {
        appId: app.id,
        platform: "tiktok",
        displayName: "Manual TikTok #1",
        platformHandle: "testuser1",
      },
      headers: authHeaders(user.id),
    })

    expect(res.error).toBeNull()
    expect(res.data.platform).toBe("tiktok")
    expect(res.data.displayName).toBe("Manual TikTok #1")
    expect(res.data.platformHandle).toBe("@testuser1")
    expect(res.data.status).toBe("active")

    const dbRow = await prisma.socialAccount.findUniqueOrThrow({
      where: { id: res.data.id },
      select: {
        accessToken: true,
        refreshToken: true,
        platformHandle: true,
        displayName: true,
      },
    })
    expect(dbRow.accessToken).toBeNull()
    expect(dbRow.refreshToken).toBeNull()
    expect(dbRow.platformHandle).toBe("@testuser1")
  })

  it("сохраняет platformHandle как есть, если @ уже в начале", async () => {
    const user = await createTestUser({ canCreate: true })
    const app = await createTestApp()

    const res = await $fetch<CreateResponse>("/api/accounts", {
      method: "POST",
      body: {
        appId: app.id,
        platform: "youtube",
        displayName: "YT Channel",
        platformHandle: "@already_handle",
      },
      headers: authHeaders(user.id),
    })

    expect(res.data.platformHandle).toBe("@already_handle")
  })

  it("создаёт аккаунт с зашифрованным accessToken, когда он передан", async () => {
    const user = await createTestUser({ canCreate: true })
    const app = await createTestApp()

    const res = await $fetch<CreateResponse>("/api/accounts", {
      method: "POST",
      body: {
        appId: app.id,
        platform: "tiktok",
        displayName: "OAuth-style TikTok",
        accessToken: "real-oauth-token-xyz",
        refreshToken: "real-refresh-xyz",
      },
      headers: authHeaders(user.id),
    })

    const dbRow = await prisma.socialAccount.findUniqueOrThrow({
      where: { id: res.data.id },
      select: { accessToken: true, refreshToken: true },
    })

    expect(dbRow.accessToken).toBeTruthy()
    expect(dbRow.accessToken).not.toBe("real-oauth-token-xyz")
    expect(dbRow.accessToken!.split(":").length).toBe(3)
    expect(dbRow.refreshToken).toBeTruthy()
    expect(dbRow.refreshToken).not.toBe("real-refresh-xyz")
    expect(dbRow.refreshToken!.split(":").length).toBe(3)
  })

  it("создаёт аккаунт без platformHandle (опциональное поле)", async () => {
    const user = await createTestUser({ canCreate: true })
    const app = await createTestApp()

    const res = await $fetch<CreateResponse>("/api/accounts", {
      method: "POST",
      body: {
        appId: app.id,
        platform: "instagram",
        displayName: "IG no handle",
      },
      headers: authHeaders(user.id),
    })

    expect(res.data.platformHandle).toBeNull()
  })

  it("400 на пустой displayName", async () => {
    const user = await createTestUser({ canCreate: true })
    const app = await createTestApp()

    await expect(
      $fetch("/api/accounts", {
        method: "POST",
        body: {
          appId: app.id,
          platform: "tiktok",
          displayName: "   ",
        },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 на невалидную platform", async () => {
    const user = await createTestUser({ canCreate: true })
    const app = await createTestApp()

    await expect(
      $fetch("/api/accounts", {
        method: "POST",
        body: {
          appId: app.id,
          platform: "facebook",
          displayName: "FB",
        },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 на несуществующий appId", async () => {
    const user = await createTestUser({ canCreate: true })

    await expect(
      $fetch("/api/accounts", {
        method: "POST",
        body: {
          appId: 9999999,
          platform: "tiktok",
          displayName: "Nope",
        },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("OAuth endpoints — disabled (410)", () => {
  it("GET /api/social/connect/:platform → 410", async () => {
    const user = await createTestUser({ canCreate: true })

    await expect(
      $fetch("/api/social/connect/tiktok", {
        method: "GET",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 410 })
  })

  it("GET /api/social/callback/:platform → 410", async () => {
    const user = await createTestUser({ canCreate: true })

    await expect(
      $fetch("/api/social/callback/tiktok", {
        method: "GET",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 410 })
  })
})
