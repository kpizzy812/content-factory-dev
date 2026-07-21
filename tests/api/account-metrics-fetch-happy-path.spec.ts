/**
 * Happy-path интеграционный тест POST /api/accounts/:id/metrics/fetch.
 *
 * Зачем отдельный spec:
 *   В account-metrics-fetch.spec.ts все тесты опираются на `ENABLE_PAID_APIS=false`
 *   → Apify всегда блокируется `requirePaidApisEnabled`. Полный путь
 *   `fetchAccountMetrics → runApifyActorRaw → wait → results → mapper →
 *    prisma.create → serializeSnapshot → response` остаётся непокрытым.
 *
 * Что покрываем здесь:
 *   - Endpoint возвращает 200 с skipped=false и snapshot.status='ok'.
 *   - BigInt-поля (followers, totalLikes, и т.д.) сериализуются как string.
 *   - В БД создаётся snapshot со status='ok' и rawData содержит sampleSize+posts.
 *
 * Как мокается Apify:
 *   Поднимаем in-process HTTP-сервер на свободном порту, подставляем его как
 *   `APIFY_BASE_URL` через env @nuxt/test-utils. `getApifyBaseUrl()` в
 *   apify-client.ts читает эту переменную → Nitro-процесс ходит в mock,
 *   а не в реальный api.apify.com.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createTestUser, authHeaders } from "../helpers/auth"
import { createTestApp, createTestSocialAccount } from "../helpers/factories"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"
import { startApifyMock, type ApifyMockHandle } from "./_helpers/apify-mock-server"

let mock: ApifyMockHandle | null = null

beforeAll(async () => {
  const fixturePath = resolve(
    __dirname,
    "../unit/fixtures/apify/tiktok-profile-sample.json",
  )
  const datasetItems = JSON.parse(readFileSync(fixturePath, "utf-8")) as unknown[]
  mock = await startApifyMock({ datasetItems })
})

afterAll(async () => {
  if (mock) await mock.close()
})

// setup() читает env при старте. Подменяем ENABLE_PAID_APIS=true и
// направляем APIFY_BASE_URL на mock. Mock уже должен быть поднят к этому моменту
// — beforeAll выше выполнился раньше топ-level await.
await setup({
  dev: true,
  server: true,
  browser: false,
  env: {
    ...nuxtTestEnv,
    ENABLE_PAID_APIS: "true",
    APIFY_TOKEN: "test-mock-token",
    APIFY_BASE_URL: mock?.baseUrl ?? "http://localhost:18890",
  },
})

describe("POST /api/accounts/:id/metrics/fetch — happy path через Apify mock", () => {
  it("создаёт snapshot со status='ok', BigInt сериализуется в string", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({
      appId: app.id,
      platform: "tiktok",
      platformHandle: "happyuser",
    })

    const res = await $fetch<{
      data: {
        skipped: boolean
        snapshot: {
          id: string
          status: string
          followers: string | null
          totalLikes: string | null
          rawData: { sampleSize: number; posts: unknown[] } | null
        }
      }
    }>(`/api/accounts/${account.id}/metrics/fetch`, {
      method: "POST",
      headers: authHeaders(user.id),
    })

    expect(res.data.skipped).toBe(false)
    expect(res.data.snapshot.status).toBe("ok")
    // mapper из tiktok-profile-sample.json: authorMeta.fans=15000 → followers
    expect(res.data.snapshot.followers).toBe("15000")
    expect(typeof res.data.snapshot.followers).toBe("string")
    // BigInt-поля сериализуются как string
    expect(res.data.snapshot.totalLikes).toBe("9000000")
    expect(typeof res.data.snapshot.totalLikes).toBe("string")
    // rawData возвращается при первом fetch (includeRaw=true в endpoint default)
    expect(res.data.snapshot.rawData).toMatchObject({
      sampleSize: 3,
      posts: expect.any(Array),
    })

    // В БД snapshot тоже создался корректно
    const dbSnapshot = await prisma.accountMetricsSnapshot.findFirst({
      where: { socialAccountId: account.id },
      orderBy: { fetchedAt: "desc" },
    })
    expect(dbSnapshot).not.toBeNull()
    expect(dbSnapshot!.status).toBe("ok")
    expect(dbSnapshot!.followers).toBe(15000n)
    expect(dbSnapshot!.errorMessage).toBeNull()
    const raw = dbSnapshot!.rawData as { sampleSize: number; posts: unknown[] }
    expect(raw.sampleSize).toBe(3)
    expect(raw.posts).toHaveLength(3)
  })
})
