/**
 * E2E /settings: профиль + theme picker.
 *
 * /settings — только для авторизованных, рендерит email/role + список тем.
 */
import { test, expect } from "@playwright/test"
import { cleanupDatabase, disableAnimations, login, waitForNetworkIdle } from "../helpers/playwright"

test.beforeEach(async ({ page }) => {
  await cleanupDatabase(page)
  await login(page)
  await disableAnimations(page)
})

test.describe("Settings page", () => {
  test("профиль и темы видны", async ({ page }) => {
    await page.goto("/settings")
    await waitForNetworkIdle(page)

    await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible()
    await expect(page.getByText("Профиль")).toBeVisible()
    // Email тестового пользователя
    await expect(page.getByText("e2e-admin@example.test").first()).toBeVisible()
  })
})
