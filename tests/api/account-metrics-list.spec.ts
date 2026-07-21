/**
 * Contract-тесты GET /api/accounts/:id/metrics.
 *
 * Покрываем:
 *   1. 401 без auth.
 *   2. 404 для несуществующего id.
 *   3. 200 с пустым snapshots[] для аккаунта без истории.
 *   4. ?limit=N ограничивает выборку.
 *   5. ?status=error фильтрует только error-снимки.
 *   6. По умолчанию rawData=null в ответе.
 *   7. ?includeRaw=1 возвращает rawData.
 *   8. snapshots отсортированы fetchedAt DESC.
 *   9. BigInt-поля сериализованы в string (не падают на JSON.stringify).
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
import type { AccountMetricsResponse } from "../../shared/types/account-metrics"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

async function seedSnapshots(
  socialAccountId: number,
  spec: Array<{ status: "ok" | "error"; followers?: bigint; fetchedAt?: Date }>,
): Promise<void> {
  // Создаём по одному, чтобы не нарушить @@unique([socialAccountId, fetchedAt])
  for (const s of spec) {
    await prisma.accountMetricsSnapshot.create({
      data: {
        socialAccountId,
        status: s.status,
        followers: s.followers ?? null,
        rawData: { sampleSize: 1, posts: [{ id: "p1", url: "u", thumbnailUrl: null, viewCount: 1, likeCount: 0, commentCount: 0, publishedAt: null, title: null }] },
        fetchedAt: s.fetchedAt ?? new Date(),
      },
    })
  }
}

describe("GET /api/accounts/:id/metrics — guard rails", () => {
  it("401 без auth", async () => {
    await expect($fetch("/api/accounts/1/metrics")).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it("404 для несуществующего id", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch(`/api/accounts/9999999/metrics`, {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("GET /api/accounts/:id/metrics — пустая история", () => {
  it("200 с snapshots=[] для нового аккаунта", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "newuser",
    })

    const res = await $fetch<AccountMetricsResponse>(
      `/api/accounts/${account.id}/metrics`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.snapshots).toEqual([])
    expect(res.data.total).toBe(0)
    expect(res.data.platform).toBe("tiktok")
    expect(res.data.platformHandle).toBe("newuser")
  })
})

describe("GET /api/accounts/:id/metrics — пагинация и сортировка", () => {
  it("?limit=2 ограничивает выборку", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "limituser",
    })
    const now = Date.now()
    await seedSnapshots(account.id, [
      { status: "ok", followers: 100n, fetchedAt: new Date(now - 3000) },
      { status: "ok", followers: 200n, fetchedAt: new Date(now - 2000) },
      { status: "ok", followers: 300n, fetchedAt: new Date(now - 1000) },
    ])

    const res = await $fetch<AccountMetricsResponse>(
      `/api/accounts/${account.id}/metrics?limit=2`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.snapshots).toHaveLength(2)
    expect(res.data.total).toBe(3)
  })

  it("snapshots отсортированы fetchedAt DESC", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "sortuser",
    })
    const now = Date.now()
    await seedSnapshots(account.id, [
      { status: "ok", followers: 100n, fetchedAt: new Date(now - 3000) },
      { status: "ok", followers: 300n, fetchedAt: new Date(now - 1000) },
      { status: "ok", followers: 200n, fetchedAt: new Date(now - 2000) },
    ])

    const res = await $fetch<AccountMetricsResponse>(
      `/api/accounts/${account.id}/metrics`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.snapshots[0]!.followers).toBe("300")
    expect(res.data.snapshots[1]!.followers).toBe("200")
    expect(res.data.snapshots[2]!.followers).toBe("100")
  })
})

describe("GET /api/accounts/:id/metrics — фильтр по status", () => {
  it("?status=ok возвращает только ok-снимки", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "filteruser",
    })
    const now = Date.now()
    await seedSnapshots(account.id, [
      { status: "ok", followers: 100n, fetchedAt: new Date(now - 3000) },
      { status: "error", fetchedAt: new Date(now - 2000) },
      { status: "ok", followers: 200n, fetchedAt: new Date(now - 1000) },
    ])

    const res = await $fetch<AccountMetricsResponse>(
      `/api/accounts/${account.id}/metrics?status=ok`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.snapshots).toHaveLength(2)
    expect(res.data.snapshots.every((s) => s.status === "ok")).toBe(true)
    expect(res.data.total).toBe(2)
  })
})

describe("GET /api/accounts/:id/metrics — rawData toggle", () => {
  it("по умолчанию rawData=null в ответе", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "rawuser1",
    })
    await seedSnapshots(account.id, [{ status: "ok", followers: 100n }])

    const res = await $fetch<AccountMetricsResponse>(
      `/api/accounts/${account.id}/metrics`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.snapshots[0]!.rawData).toBeNull()
  })

  it("?includeRaw=1 возвращает rawData с posts[]", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "rawuser2",
    })
    await seedSnapshots(account.id, [{ status: "ok", followers: 100n }])

    const res = await $fetch<AccountMetricsResponse>(
      `/api/accounts/${account.id}/metrics?includeRaw=1`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.snapshots[0]!.rawData).not.toBeNull()
    expect(res.data.snapshots[0]!.rawData!.posts).toHaveLength(1)
    expect(res.data.snapshots[0]!.rawData!.sampleSize).toBe(1)
  })
})

describe("GET /api/accounts/:id/metrics — BigInt сериализация", () => {
  it("followers возвращается как string, не падает на JSON", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "bigintuser",
    })
    // Большое число которое не помещается в Int32, но влезает в BigInt
    await seedSnapshots(account.id, [
      { status: "ok", followers: 3_000_000_000n },
    ])

    const res = await $fetch<AccountMetricsResponse>(
      `/api/accounts/${account.id}/metrics`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.snapshots[0]!.followers).toBe("3000000000")
    expect(typeof res.data.snapshots[0]!.followers).toBe("string")
  })
})
