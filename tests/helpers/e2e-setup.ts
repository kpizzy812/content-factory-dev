/**
 * Data-setup хелперы для E2E. Используют реальные API endpoints через
 * page.request с сессионной cookie от login() — то есть проходят все
 * permission-проверки и пишут через реальные validators.
 *
 * Использование:
 *   await login(page)
 *   const data = await setupTestData(page, { proxies: 2 })
 */
import type { Page } from "@playwright/test"

interface SetupOptions {
  proxies?: number
  apps?: number
  accounts?: { appId: number; platform?: "youtube" | "tiktok" | "instagram" }[]
}

export interface SetupResult {
  appIds: number[]
  proxyIds: string[]
  accountIds: number[]
}

export async function setupTestData(
  page: Page,
  opts: SetupOptions = {},
): Promise<SetupResult> {
  const result: SetupResult = { appIds: [], proxyIds: [], accountIds: [] }

  // POST /api/admin/apps требует canAdmin — создаётся в login() по умолчанию.
  const appsToCreate = opts.apps ?? (opts.accounts?.length ? 1 : 0)
  for (let i = 0; i < appsToCreate; i++) {
    const res = await page.request.post("/api/admin/apps", {
      data: { name: `E2E App ${i + 1}` },
    })
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(
        `[setupTestData] POST /api/admin/apps failed: ${res.status()} ${body.slice(0, 200)}`,
      )
    }
    const json = (await res.json()) as { data?: { id: number }; id?: number }
    const id = json.data?.id ?? json.id
    if (!id) throw new Error("[setupTestData] POST /api/admin/apps: no id in response")
    result.appIds.push(id)
  }

  for (let i = 0; i < (opts.proxies ?? 0); i++) {
    const res = await page.request.post("/api/proxies", {
      data: {
        label: `E2E Proxy ${i + 1}`,
        type: "residential",
        protocol: "http",
        host: `10.0.0.${i + 1}`,
        port: 1080,
        username: `u${i + 1}`,
        password: `p${i + 1}`,
        provider: null,
        rotationUrl: null,
        expectedCountry: null,
        expectedCity: null,
        monthlyTrafficGB: null,
        expiresAt: null,
        notes: null,
      },
    })
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(
        `[setupTestData] POST /api/proxies failed: ${res.status()} ${body.slice(0, 200)}`,
      )
    }
    const json = (await res.json()) as { data: { id: string } }
    result.proxyIds.push(json.data.id)
  }

  // Счётчики per-platform для предсказуемых displayName
  // (E2E youtube #1, E2E tiktok #1, E2E youtube #2, ...)
  const perPlatformIdx: Record<string, number> = {}
  for (const acc of opts.accounts ?? []) {
    const platform = acc.platform ?? "youtube"
    perPlatformIdx[platform] = (perPlatformIdx[platform] ?? 0) + 1
    const res = await page.request.post("/api/accounts", {
      data: {
        appId: acc.appId,
        platform,
        displayName: `E2E ${platform} #${perPlatformIdx[platform]}`,
        accessToken: "e2e-access-token",
      },
    })
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(
        `[setupTestData] POST /api/accounts failed: ${res.status()} ${body.slice(0, 200)}`,
      )
    }
    const json = (await res.json()) as { data: { id: number } }
    result.accountIds.push(json.data.id)
  }

  return result
}
