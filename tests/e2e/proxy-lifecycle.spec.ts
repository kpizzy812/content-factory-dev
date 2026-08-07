/**
 * E2E proxy lifecycle: empty state → add → reveal → delete.
 *
 * Все тесты идут под admin-сессией от login() и стартуют с чистой БД через
 * cleanupDatabase. setupTestData используется когда нужны pre-existing записи.
 *
 * hostMasked-инвариант: в карточке отображается замаскированный host
 * (вида 8.X.X.X), plain — только в модалке доступов после указания причины.
 *
 * Модалки после переноса макетов — не нативный <dialog>, а UiModal:
 * div[role="dialog"] в портале body.
 */
import { expect, test } from "@playwright/test"
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
    await expect(page.getByText("Прокси пока нет")).toBeVisible()
    await expect(page.getByRole("button", { name: "Добавить прокси" })).toBeVisible()
  })

  test("добавление прокси через модалку → карточка в сетке", async ({ page }) => {
    await page.goto("/proxies")
    await waitForNetworkIdle(page)

    await page.getByRole("button", { name: "Добавить прокси" }).click()

    const modal = page.locator('[role="dialog"]')
    await expect(modal).toBeVisible()

    await modal.locator('input[placeholder*="Mobile RU"]').fill("E2E Test Proxy")
    await modal.locator('input[placeholder="proxy.example.com"]').fill("8.8.8.8")
    await modal.locator('input[placeholder="8080"]').fill("1080")

    // Поля доступов подписаны обёрткой UiField: label — прямой потомок блока.
    await modal.locator('div:has(> label:text-is("Username")) input').fill("u1")
    await modal.locator('div:has(> label:text-is("Password")) input').fill("p1")

    await modal.getByRole("button", { name: "Создать" }).click()

    await expect(page.getByRole("heading", { name: "E2E Test Proxy" })).toBeVisible({ timeout: 10000 })
    // hostMasked: код вида 8.X.X.X:1080
    await expect(page.locator("code", { hasText: /:1080/ }).first()).toBeVisible()
  })

  test("показ доступов через модалку с причиной", async ({ page }) => {
    const { proxyIds } = await setupTestData(page, { proxies: 1 })
    expect(proxyIds.length).toBe(1)

    await page.goto("/proxies")
    await waitForNetworkIdle(page)

    await expect(page.getByRole("heading", { name: "E2E Proxy 1" })).toBeVisible()

    await page.getByRole("button", { name: "Доступы" }).first().click()

    const modal = page.locator('[role="dialog"]')
    await expect(modal.getByText("Расшифровка кредов")).toBeVisible()

    // Шаг 1: причина, минимум 10 символов
    await modal.locator("textarea").first().fill("E2E reveal verification check")
    await modal.getByRole("button", { name: "Показать креды" }).click()

    // Шаг 2: видим расшифрованные значения
    await expect(modal.locator("code", { hasText: "10.0.0.1" }).first()).toBeVisible({ timeout: 10000 })
    await expect(modal.locator("code", { hasText: "u1" }).first()).toBeVisible()

    await modal.getByRole("button", { name: "Закрыть" }).click()
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  })

  test("удаление прокси через подтверждение", async ({ page }) => {
    const { proxyIds } = await setupTestData(page, { proxies: 1 })
    expect(proxyIds.length).toBe(1)

    await page.goto("/proxies")
    await waitForNetworkIdle(page)

    await expect(page.getByRole("heading", { name: "E2E Proxy 1" })).toBeVisible()

    await page.getByRole("button", { name: "Удалить" }).first().click()

    const modal = page.locator('[role="dialog"]')
    await expect(modal.getByText("Удалить прокси?")).toBeVisible()
    await modal.getByRole("button", { name: "Удалить" }).click()

    await expect(page.getByRole("heading", { name: "E2E Proxy 1" })).toHaveCount(0, { timeout: 10000 })
  })
})
