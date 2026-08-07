/**
 * E2E /settings: профиль и оформление.
 *
 * /settings — только для авторизованных, показывает почту с ролью, выбор темы
 * и состояние MarketingCamp.
 */
import { expect, test } from "@playwright/test"
import { cleanupDatabase, disableAnimations, login, waitForNetworkIdle } from "../helpers/playwright"

test.beforeEach(async ({ page }) => {
  await cleanupDatabase(page)
  await login(page)
  await disableAnimations(page)
})

test.describe("Settings page", () => {
  test("профиль и оформление видны", async ({ page }) => {
    await page.goto("/settings")
    await waitForNetworkIdle(page)

    await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Оформление" })).toBeVisible()
    // Почта тестового пользователя
    await expect(page.getByText("e2e-admin@example.test").first()).toBeVisible()
  })
})
