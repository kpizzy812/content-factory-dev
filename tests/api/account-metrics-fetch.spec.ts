/**
 * Contract-тесты POST /api/accounts/:id/metrics/fetch.
 *
 * Покрываем:
 *   1. 401 без auth.
 *   2. 400 если platformHandle=null.
 *   3. 404 если аккаунт не найден.
 *   4. 200 с skipped=true при втором вызове в течение 24h (idempotency).
 *   5. 200 с skipped=false при ?force=1 (refetch).
 *   6. 502 если Apify заблокирован (ENABLE_PAID_APIS=false по умолчанию в test-env).
 *   7. error-snapshot пишется в БД при 502.
 *
 * Real Apify не вызываем — флаг ENABLE_PAID_APIS=false блокирует через
 * requirePaidApisEnabled в apify-client.ts.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import {
  createTestApp,
  createTestSocialAccount,
} from "../helpers/factories"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

describe("POST /api/accounts/:id/metrics/fetch — guard rails", () => {
  it("401 без auth", async () => {
    await expect(
      $fetch("/api/accounts/1/metrics/fetch", { method: "POST" }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it("400 если platformHandle=null", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: null,
    })

    await expect(
      $fetch(`/api/accounts/${account.id}/metrics/fetch`, {
        method: "POST",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 для несуществующего аккаунта", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch(`/api/accounts/9999999/metrics/fetch`, {
        method: "POST",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("400 при невалидном id", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch(`/api/accounts/-1/metrics/fetch`, {
        method: "POST",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe("POST /api/accounts/:id/metrics/fetch — 24h idempotency", () => {
  it("второй fetch в течение 24h возвращает skipped=true с последним 'ok'-снимком", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "freshcache",
    })

    // Создаём свежий 'ok'-snapshot (полчаса назад)
    const recent = await prisma.accountMetricsSnapshot.create({
      data: {
        socialAccountId: account.id,
        status: "ok",
        followers: 1000n,
        postsCount: 5,
        rawData: { sampleSize: 5, posts: [] },
        fetchedAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    })

    const res = await $fetch<{
      data: { skipped: boolean; snapshot: { id: string; status: string } }
    }>(`/api/accounts/${account.id}/metrics/fetch`, {
      method: "POST",
      headers: authHeaders(user.id),
    })

    expect(res.data.skipped).toBe(true)
    expect(res.data.snapshot.id).toBe(recent.id)
    expect(res.data.snapshot.status).toBe("ok")
  })

  it("error-snapshot НЕ блокирует новый fetch (только ok-снимки участвуют в idempotency)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "errorcache",
    })

    // Только error-снимки
    await prisma.accountMetricsSnapshot.create({
      data: {
        socialAccountId: account.id,
        status: "error",
        errorMessage: "old error",
        rawData: { sampleSize: 0, posts: [] },
        fetchedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    })

    // ENABLE_PAID_APIS=false → ожидаем 502, не skipped=true
    await expect(
      $fetch(`/api/accounts/${account.id}/metrics/fetch`, {
        method: "POST",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 502 })
  })

  it("снимок старше 24h не блокирует — приходим к Apify, ловим 502", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "oldcache",
    })

    await prisma.accountMetricsSnapshot.create({
      data: {
        socialAccountId: account.id,
        status: "ok",
        followers: 999n,
        rawData: { sampleSize: 0, posts: [] },
        // 25 часов назад — за окном 24h
        fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    })

    await expect(
      $fetch(`/api/accounts/${account.id}/metrics/fetch`, {
        method: "POST",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe("POST /api/accounts/:id/metrics/fetch — Apify ошибка", () => {
  it("502 + error-snapshot записан, когда Apify заблокирован (ENABLE_PAID_APIS=false)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "blockedscraper",
    })

    await expect(
      $fetch(`/api/accounts/${account.id}/metrics/fetch`, {
        method: "POST",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 502 })

    // Проверяем что error-snapshot действительно создался
    const snapshots = await prisma.accountMetricsSnapshot.findMany({
      where: { socialAccountId: account.id },
    })
    expect(snapshots.length).toBe(1)
    expect(snapshots[0]!.status).toBe("error")
    expect(snapshots[0]!.errorMessage).toBeTruthy()
  })

  it("?force=1 игнорирует 24h cache даже при наличии свежего ok-снимка", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "forceuser",
    })

    await prisma.accountMetricsSnapshot.create({
      data: {
        socialAccountId: account.id,
        status: "ok",
        followers: 500n,
        rawData: { sampleSize: 0, posts: [] },
      },
    })

    // С force=1 даём ход Apify-вызову → ловим 502 (paid APIs off)
    await expect(
      $fetch(`/api/accounts/${account.id}/metrics/fetch?force=1`, {
        method: "POST",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe("POST /api/accounts/:id/metrics/fetch — RBAC", () => {
  it("403 если пользователь не имеет canWrite", async () => {
    const user = await createTestUser({
      canAdmin: false,
      canWrite: false,
      canRead: true,
      moduleAccess: ["social-upload"],
    })
    const app = await createTestApp()
    await prisma.userAppAssignment.create({
      data: {
        userId: user.id,
        appId: app.id,
        appName: app.name,
        accessLevel: "full",
        accounts: "all",
        geos: "all",
        permissions: "full",
      },
    })
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "rbacuser",
    })

    await expect(
      $fetch(`/api/accounts/${account.id}/metrics/fetch`, {
        method: "POST",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
