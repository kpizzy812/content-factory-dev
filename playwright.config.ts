import { defineConfig, devices } from "@playwright/test"
import dotenv from "dotenv"

// Подгружаем .env.test до любых импортов webServer.env — нам нужны TEST_AUTH_TOKEN и пр.
dotenv.config({ path: ".env.test" })

const PORT = 3100
const BASE_URL = `http://127.0.0.1:${PORT}`

/**
 * Playwright config для ZavodCamp.
 *
 * Порт 3100 (НЕ 3000 — там обычный dev-сервер; НЕ 3001 — там MarketingCamp).
 * 4 viewport-проекта: 1920x1080, 1280x800, 768x1024, 375x812.
 *
 * webServer запускает `bun run dev --port 3100` с подменой env: NODE_ENV=test,
 * SCHEDULERS_ENABLED=false, TEST_AUTH_BYPASS=1, mock-флаги. БД — test PG (5436).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { outputFolder: "tests/playwright-report", open: "never" }], ["list"]],
  outputDir: "tests/test-results",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "Desktop Chrome 1920",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "Desktop Chrome 1280",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // Viewport-only (без эмуляции iPad), потому что WebKit-браузер
      // не установлен — экономим CI-время. Реальное iPad-поведение
      // покрывается отдельным проектом при включении WebKit.
      name: "Tablet 768",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, isMobile: false },
    },
    {
      name: "Mobile 375",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: false },
    },
  ],
  webServer: {
    command: `bun run dev --port ${PORT} --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD ?? "",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
      MARKETING_CAMP_URL: process.env.MARKETING_CAMP_URL ?? "",
      INTER_SERVICE_API_KEY: process.env.INTER_SERVICE_API_KEY ?? "",
      ZAVOD_API_KEY: process.env.ZAVOD_API_KEY ?? "",
      SCHEDULERS_ENABLED: "false",
      POSTING_WORKER_ENABLED: "false",
      PROXY_HEALTH_CHECK_ENABLED: "false",
      // Унаследованные зоны выключены в проде, но E2E продолжает их покрывать,
      // пока код не удалён (proxy-lifecycle, mobile-navigation на /proxies).
      LEGACY_DEVICE_AUTOMATION_ENABLED: "true",
      LEGACY_PROXY_POOL_ENABLED: "true",
      LEGACY_GOOGLE_DRIVE_ENABLED: "true",
      ENABLE_PAID_APIS: "false",
      ENABLE_SOCIAL_POSTING: "false",
      PROXY_MOCK_MODE: "true",
      ANTHROPIC_MOCK_MODE: "true",
      FAL_MOCK_MODE: "true",
      TELEGRAM_MOCK_MODE: "true",
      TEST_AUTH_BYPASS: "1",
      TEST_AUTH_TOKEN: process.env.TEST_AUTH_TOKEN ?? "",
    },
  },
})
