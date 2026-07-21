/**
 * Хелперы для Playwright E2E.
 *
 * login(page, opts)        — устанавливает zavod-session cookie через
 *                             POST /api/_test/login (test-only bypass).
 * disableAnimations(page)  — глушит CSS-анимации/transition для стабильных
 *                             визуальных тестов и ускорения.
 * waitForNetworkIdle(page) — обёртка над waitForLoadState('networkidle').
 * cleanupDatabase(page)    — TRUNCATE всех таблиц через /api/_test/cleanup.
 *
 * Test bypass работает только если:
 *   NODE_ENV !== "production"
 *   process.env.TEST_AUTH_BYPASS === "1"
 *   заголовок x-test-auth-token === process.env.TEST_AUTH_TOKEN
 * См. server/api/_test/login.post.ts и server/api/_test/cleanup.post.ts.
 */
import type { Page } from "@playwright/test"

interface LoginOptions {
  email?: string
  rolePreset?: "admin" | "producer" | "operator" | "analyst" | "observer"
  canAdmin?: boolean
}

function testAuthHeader(): Record<string, string> {
  const token = process.env.TEST_AUTH_TOKEN
  if (!token) {
    throw new Error(
      "[tests/helpers/playwright] TEST_AUTH_TOKEN не задан в окружении. Проверь .env.test."
    )
  }
  return { "x-test-auth-token": token }
}

export async function login(
  page: Page,
  opts: LoginOptions = {},
): Promise<{ id: number; email: string }> {
  const res = await page.request.post("/api/_test/login", {
    headers: testAuthHeader(),
    data: {
      email: opts.email ?? "e2e-admin@example.test",
      rolePreset: opts.rolePreset ?? "admin",
      canAdmin: opts.canAdmin ?? true,
    },
  })

  if (!res.ok()) {
    const body = await res.text()
    throw new Error(
      `[tests/helpers/playwright] login() failed: ${res.status()} ${body.slice(0, 200)}`,
    )
  }

  const json = (await res.json()) as { user: { id: number; email: string } }
  return json.user
}

/**
 * Отключает анимации/transition/scroll-smooth — снижает flakiness
 * при ассертах на видимость и ускоряет тесты на 4 viewport'ах.
 */
export async function disableAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      html { scroll-behavior: auto !important; }
    `,
  })
}

export async function waitForNetworkIdle(page: Page, timeout = 5000): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout })
  } catch {
    // networkidle может не сработать из-за websocket/long-poll —
    // не считаем фатальной ошибкой.
  }
}

export async function cleanupDatabase(page: Page): Promise<void> {
  const res = await page.request.post("/api/_test/cleanup", {
    headers: testAuthHeader(),
  })
  if (!res.ok()) {
    const body = await res.text()
    throw new Error(
      `[tests/helpers/playwright] cleanupDatabase() failed: ${res.status()} ${body.slice(0, 200)}`,
    )
  }
}
