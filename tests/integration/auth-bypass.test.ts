/**
 * Integration smoke: TEST_AUTH_BYPASS реально пускает запросы в API
 * через requirePermission, без Cookie-сессии.
 *
 * Эндпоинт под тестом — GET /api/admin/accounts-health (требует canAdmin).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"

await setup({
  // Nuxt будет поднят в дочернем процессе.
  // dev: true важен — иначе @nuxt/test-utils выставляет NODE_ENV=production,
  // и наш TEST_AUTH_BYPASS-гейт перестаёт работать (по дизайну).
  dev: true,
  server: true,
  browser: false,
  env: {
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL ?? "",
    NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD ?? "",
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
    SCHEDULERS_ENABLED: "false",
    POSTING_WORKER_ENABLED: "false",
    PROXY_HEALTH_CHECK_ENABLED: "false",
    ENABLE_PAID_APIS: "false",
    ENABLE_SOCIAL_POSTING: "false",
    PROXY_MOCK_MODE: "true",
    ANTHROPIC_MOCK_MODE: "true",
    FAL_MOCK_MODE: "true",
    TELEGRAM_MOCK_MODE: "true",
    TEST_AUTH_BYPASS: "1",
    TEST_AUTH_TOKEN: process.env.TEST_AUTH_TOKEN ?? "",
  },
})

describe("TEST_AUTH_BYPASS через getAuthContext", () => {
  it("пускает admin-юзера в /api/admin/accounts-health", async () => {
    const user = await createTestUser({ canAdmin: true })

    const res = await $fetch<{
      data: {
        summary: Record<string, number>
        byPlatform: Record<string, number>
        accounts: unknown[]
      }
    }>("/api/admin/accounts-health", {
      headers: authHeaders(user.id),
    })

    expect(res).toBeTruthy()
    expect(res.data).toBeTruthy()
    expect(res.data.summary).toBeTruthy()
    expect(typeof res.data.summary.total).toBe("number")
    expect(Array.isArray(res.data.accounts)).toBe(true)
  })

  it("без заголовков отвечает 401 (bypass не активируется)", async () => {
    await expect(
      $fetch("/api/admin/accounts-health"),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
