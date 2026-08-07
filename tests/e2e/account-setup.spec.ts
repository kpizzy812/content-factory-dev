/**
 * E2E account setup flow: empty state → модалка подключения → карточки из сида.
 *
 * UI создания аккаунта в проде идёт через OAuth — поэтому E2E использует
 * setupTestData, который дёргает POST /api/accounts (manual fallback) с
 * mock accessToken. Это покрывает основной UX страницы /accounts:
 * пустое состояние, список платформ в модалке и таблицу аккаунтов.
 */
import { expect, test } from "@playwright/test"
import { cleanupDatabase, disableAnimations, login, waitForNetworkIdle } from "../helpers/playwright"
import { setupTestData } from "../helpers/e2e-setup"

test.beforeEach(async ({ page }) => {
  await cleanupDatabase(page)
  await login(page)
  await disableAnimations(page)
})

test.describe("Account setup", () => {
  test("empty state показывает кнопку подключения", async ({ page }) => {
    await page.goto("/accounts")
    await waitForNetworkIdle(page)

    await expect(page.getByRole("heading", { name: "Аккаунты", exact: true })).toBeVisible()
    await expect(page.getByText("Ни один аккаунт не подключён")).toBeVisible()
    await expect(page.getByRole("button", { name: "Подключить аккаунт" })).toBeVisible()
  })

  test("модалка подключения показывает три платформы", async ({ page }) => {
    await page.goto("/accounts")
    await waitForNetworkIdle(page)

    await page.getByRole("button", { name: "Подключить аккаунт" }).click()

    const modal = page.locator('[role="dialog"]')
    await expect(modal.getByText("Подключить аккаунт")).toBeVisible()
    await expect(modal.getByText("Instagram", { exact: true })).toBeVisible()
    await expect(modal.getByText("TikTok", { exact: true })).toBeVisible()
    await expect(modal.getByText("YouTube", { exact: true })).toBeVisible()
  })

  test("аккаунты из сида видны в списке", async ({ page }) => {
    const { appIds } = await setupTestData(page, { apps: 1 })
    expect(appIds.length).toBe(1)

    const seeded = await setupTestData(page, {
      accounts: [
        { appId: appIds[0]!, platform: "youtube" },
        { appId: appIds[0]!, platform: "tiktok" },
      ],
    })
    expect(seeded.accountIds.length).toBe(2)

    await page.goto("/accounts")
    await waitForNetworkIdle(page)

    await expect(page.getByText("E2E youtube #1").first()).toBeVisible()
    await expect(page.getByText("E2E tiktok #1").first()).toBeVisible()
  })

  test("клик по строке открывает панель аккаунта", async ({ page }) => {
    const { appIds } = await setupTestData(page, { apps: 1 })
    const seeded = await setupTestData(page, {
      accounts: [{ appId: appIds[0]!, platform: "youtube" }],
    })
    expect(seeded.accountIds.length).toBe(1)

    await page.goto("/accounts")
    await waitForNetworkIdle(page)

    await page.getByText("E2E youtube #1").first().click()

    // Панель детали — drawer с идентификатором аккаунта в подзаголовке.
    await expect(page.getByText(/account_\d+/).first()).toBeVisible({ timeout: 10000 })
  })
})
