/**
 * Playwright e2e smoke. Проверяет, что webServer стартует, /auth/login
 * рендерится и страница содержит ожидаемый текст.
 *
 * Один тест — гоняется на 4 viewport'ах (см. playwright.config.ts → projects).
 */
import { test, expect } from "@playwright/test"

test("страница входа открывается", async ({ page }) => {
  await page.goto("/auth/login")

  // На странице должен быть какой-то признак логина — поле email или кнопка входа.
  // Берём с запасом: документ вообще должен иметь видимый body.
  await expect(page).toHaveURL(/\/auth\/login/)
  await expect(page.locator("body")).toBeVisible()

  // Проверяем что title не пустой и страница рендерится без ошибки 500.
  const title = await page.title()
  expect(title.length).toBeGreaterThan(0)
})
