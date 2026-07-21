/**
 * E2E auth flow.
 *
 * Перед каждым тестом — TRUNCATE через /api/_test/cleanup. login() в
 * happy-path ходит через test-bypass /api/_test/login (cookie zavod-session).
 * Реальный POST /api/auth/login не используется в success-кейсах: он зависит
 * от MarketingCamp, которой в test-окружении нет.
 *
 * Прогоняется на 4 viewport'ах автоматически (см. playwright.config.ts → projects).
 */
import { test, expect } from "@playwright/test"
import { cleanupDatabase, disableAnimations, login, waitForNetworkIdle } from "../helpers/playwright"

test.beforeEach(async ({ page }) => {
  await cleanupDatabase(page)
})

test.describe("Auth flow", () => {
  test("страница логина рендерится с формой", async ({ page }) => {
    await page.goto("/auth/login")
    await waitForNetworkIdle(page)

    await expect(page).toHaveURL(/\/auth\/login/)
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test("анонимный визит на защищённую страницу редиректит на /auth/login", async ({ page }) => {
    await page.goto("/proxies")
    await page.waitForURL(/\/auth\/login/, { timeout: 10000 })
    await expect(page).toHaveURL(/\/auth\/login/)
  })

  test("после login через test-bypass — открывается главная и видна навигация", async ({ page }) => {
    await login(page)
    await page.goto("/")
    await waitForNetworkIdle(page)
    await disableAnimations(page)

    // Не на /auth/login
    await expect(page).not.toHaveURL(/\/auth\/login/)
    // Кнопка выхода в navbar — видна на любом viewport
    await expect(page.locator('button:has-text("Выйти")').first()).toBeVisible()
  })

  test("logout возвращает на /auth/login", async ({ page }) => {
    await login(page)
    await page.goto("/")
    await waitForNetworkIdle(page)
    await disableAnimations(page)

    await page.locator('button:has-text("Выйти")').first().click()
    await page.waitForURL(/\/auth\/login/, { timeout: 10000 })
    await expect(page).toHaveURL(/\/auth\/login/)
  })
})
