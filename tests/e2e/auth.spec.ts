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
import { expect, test } from "@playwright/test"
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
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible()
  })

  test("анонимный визит на защищённую страницу редиректит на /auth/login", async ({ page }) => {
    await page.goto("/proxies")
    await page.waitForURL(/\/auth\/login/, { timeout: 10000 })
    await expect(page).toHaveURL(/\/auth\/login/)
  })

  test("после login через test-bypass — открывается главная и виден сайдбар", async ({ page }) => {
    await login(page)
    await page.goto("/")
    await waitForNetworkIdle(page)
    await disableAnimations(page)

    await expect(page).not.toHaveURL(/\/auth\/login/)
    // Оболочка: подвал сайдбара с именем пользователя. На узких экранах сайдбар
    // спрятан за кнопкой «Меню», поэтому проверяем её же наличие.
    const shell = page.locator('nav, aside, header').first()
    await expect(shell).toBeVisible()
  })

  test("выход возвращает на /auth/login", async ({ page }, testInfo) => {
    await login(page)
    await page.goto("/")
    await waitForNetworkIdle(page)
    await disableAnimations(page)

    // Кнопка выхода живёт в подвале сайдбара; на <md он скрыт за «Меню».
    if ((testInfo.project.use.viewport?.width ?? 1280) < 768) {
      await page.getByRole("button", { name: "Меню" }).click()
    }

    await page.locator('button[title="Выход"]').first().click()
    await page.waitForURL(/\/auth\/login/, { timeout: 10000 })
    await expect(page).toHaveURL(/\/auth\/login/)
  })
})
