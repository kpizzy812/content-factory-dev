/**
 * E2E proxy lifecycle: empty state → add → reveal → delete.
 *
 * Все тесты идут под admin-сессией от login() и стартуют с чистой БД через
 * cleanupDatabase. setupTestData используется когда нужны pre-existing записи.
 *
 * hostMasked-инвариант: в карточке отображается замаскированный host
 * (вида 10.X.X.X), plain — только в reveal-модалке после причины.
 */
import { test, expect } from "@playwright/test"
import { cleanupDatabase, disableAnimations, login, waitForNetworkIdle } from "../helpers/playwright"
import { setupTestData } from "../helpers/e2e-setup"

test.beforeEach(async ({ page }) => {
  await cleanupDatabase(page)
  await login(page)
  await disableAnimations(page)
})

test.describe("Proxy lifecycle", () => {
  test("empty state показывает кнопку добавления", async ({ page }) => {
    await page.goto("/proxies")
    await waitForNetworkIdle(page)

    await expect(page.getByRole("heading", { name: "Прокси", exact: true })).toBeVisible()
    await expect(page.getByText(/Нет добавленных прокси/i)).toBeVisible()
    await expect(page.locator('button:has-text("Добавить прокси")')).toBeVisible()
  })

  test("добавление прокси через модалку → карточка в сетке", async ({ page }) => {
    await page.goto("/proxies")
    await waitForNetworkIdle(page)

    await page.locator('button:has-text("Добавить прокси")').click()
    await expect(page.locator("dialog.modal[open]").first()).toBeVisible()

    await page.locator('input[placeholder*="Mobile RU"]').fill("E2E Test Proxy")
    await page.locator('input[placeholder*="proxy.example.com"]').fill("8.8.8.8")
    await page.locator('input[placeholder="8080"]').fill("1080")

    // username/password — позиционируем через fieldset legend
    await page.locator("fieldset:has(legend:has-text('Username')) input").fill("u1")
    await page.locator("fieldset:has(legend:has-text('Password')) input").fill("p1")

    await page.locator('button:has-text("Создать")').click()

    // Ждём появления карточки прокси
    await expect(page.locator("h3", { hasText: "E2E Test Proxy" })).toBeVisible({ timeout: 10000 })
    // hostMasked: код вида 8.X.X.X:1080
    await expect(page.locator("code", { hasText: /:1080/ })).toBeVisible()
  })

  test("reveal credentials через модалку с причиной", async ({ page }) => {
    const { proxyIds } = await setupTestData(page, { proxies: 1 })
    expect(proxyIds.length).toBe(1)

    await page.goto("/proxies")
    await waitForNetworkIdle(page)

    await expect(page.locator("h3", { hasText: "E2E Proxy 1" })).toBeVisible()

    // Кнопка "Креды" на карточке
    await page.locator('button:has-text("Креды")').first().click()
    await expect(page.locator('h3:has-text("Расшифровка кредов")')).toBeVisible()

    // Step 1: причина (минимум 10 символов)
    await page.locator("textarea[placeholder*='Indigo']").fill("E2E reveal verification check")
    await page.locator('button:has-text("Показать креды")').click()

    // Step 2: видим plain creds
    await expect(page.locator('h3:has-text("Расшифровка кредов")')).toBeVisible()
    await expect(page.locator("code", { hasText: "10.0.0.1" }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator("code", { hasText: "u1" }).first()).toBeVisible()

    // Закрыть модалку — кнопка внутри dialog с заголовком "Расшифровка кредов"
    await page
      .locator("dialog[open]:has(h3:text('Расшифровка кредов')) button:has-text('Закрыть')")
      .click()
  })

  test("удаление прокси через подтверждение", async ({ page }) => {
    const { proxyIds } = await setupTestData(page, { proxies: 1 })
    expect(proxyIds.length).toBe(1)

    await page.goto("/proxies")
    await waitForNetworkIdle(page)

    await expect(page.locator("h3", { hasText: "E2E Proxy 1" })).toBeVisible()

    // Кнопка "Удалить" на карточке
    await page.locator('button:has-text("Удалить")').first().click()

    // Confirm-модалка
    await expect(page.locator('h3:has-text("Удалить прокси?")')).toBeVisible()
    // В модалке тоже есть кнопка "Удалить" (со стилем btn-error)
    await page.locator(".modal-open button:has-text('Удалить'), dialog[open] button:has-text('Удалить')").last().click()

    await expect(page.locator("h3", { hasText: "E2E Proxy 1" })).toHaveCount(0, { timeout: 10000 })
  })
})
