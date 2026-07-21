/**
 * E2E account setup flow: empty state → connect dropdown → render seeded accounts.
 *
 * UI создания аккаунта в проде идёт через OAuth — поэтому E2E использует
 * setupTestData, который дёргает POST /api/accounts (manual fallback) с
 * mock accessToken. Это покрывает основной UX страницы /accounts:
 * рендер карточек, открытие edit-модалки с табами Доступы/Прокси/Indigo/Прогрев.
 */
import { test, expect } from "@playwright/test"
import { cleanupDatabase, disableAnimations, login, waitForNetworkIdle } from "../helpers/playwright"
import { setupTestData } from "../helpers/e2e-setup"

test.beforeEach(async ({ page }) => {
  await cleanupDatabase(page)
  await login(page)
  await disableAnimations(page)
})

test.describe("Account setup", () => {
  test("empty state показывает кнопку Подключить", async ({ page }) => {
    await page.goto("/accounts")
    await waitForNetworkIdle(page)

    await expect(page.getByRole("heading", { name: /Аккаунты соцсетей/i })).toBeVisible()
    await expect(page.getByText(/Нет подключённых аккаунтов/i)).toBeVisible()
    await expect(page.locator('button:has-text("Подключить аккаунт")')).toBeVisible()
  })

  test("dropdown платформ открывается и содержит все 3 опции", async ({ page }) => {
    await page.goto("/accounts")
    await waitForNetworkIdle(page)

    await page.locator('button:has-text("Подключить аккаунт")').click()
    // Внутри dropdown ищем платформу через role=button + name
    await expect(page.getByRole("button", { name: "YouTube" })).toBeVisible()
    await expect(page.getByRole("button", { name: "TikTok" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Instagram" })).toBeVisible()
  })

  test("карточки аккаунтов рендерятся из seed-данных", async ({ page }) => {
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

    await expect(page.locator("h3", { hasText: "E2E youtube #1" })).toBeVisible()
    await expect(page.locator("h3", { hasText: "E2E tiktok #1" })).toBeVisible()
  })

  test("открытие edit-модалки аккаунта показывает 4 таба", async ({ page }) => {
    const { appIds } = await setupTestData(page, { apps: 1 })
    const seeded = await setupTestData(page, {
      accounts: [{ appId: appIds[0]!, platform: "youtube" }],
    })
    expect(seeded.accountIds.length).toBe(1)

    await page.goto("/accounts")
    await waitForNetworkIdle(page)

    const editButton = page.locator('button:has-text("Редактировать")').first()
    await editButton.click()

    await expect(page.locator('h3:has-text("Редактирование аккаунта")')).toBeVisible()
    await expect(page.locator('button[role="tab"]:has-text("Доступы")')).toBeVisible()
    await expect(page.locator('button[role="tab"]:has-text("Прокси")')).toBeVisible()
    await expect(page.locator('button[role="tab"]:has-text("Indigo")')).toBeVisible()
    await expect(page.locator('button[role="tab"]:has-text("Прогрев")')).toBeVisible()
  })
})
