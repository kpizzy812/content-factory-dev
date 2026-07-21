import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const rootDir = dirname(fileURLToPath(import.meta.url))

/**
 * Конфиг Vitest для ZavodCamp.
 *
 * Используется обычный defineConfig (НЕ defineVitestConfig из @nuxt/test-utils),
 * потому что обёртка Nuxt подключает vite-builder и падает на старте unit-тестов.
 *
 * Integration-тесты сами поднимают Nuxt-окружение через `await setup({ server: true })`
 * из @nuxt/test-utils/e2e — это полноценный Nitro-процесс, $fetch ходит туда.
 *
 * Структура:
 * - tests/unit/**       — happy-dom, чистые тесты shared-логики.
 * - tests/integration/**— happy-dom + setup() из nuxt/test-utils в каждом suite.
 * - tests/api/**        — contract-тесты HTTP-эндпоинтов (security/CRUD/validation),
 *                          формируют пары /api/<feature>-<aspect>.spec.ts.
 * - tests/e2e/**        — Playwright (исключено из Vitest).
 *
 * singleThread: true — критично, потому что afterEach делает TRUNCATE
 * по всей public-схеме test-DB.
 */
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    include: [
      "tests/unit/**/*.{test,spec}.ts",
      "tests/integration/**/*.{test,spec}.ts",
      "tests/api/**/*.{test,spec}.ts",
    ],
    exclude: ["tests/e2e/**", "node_modules/**", ".nuxt/**", ".output/**"],
  },
  resolve: {
    alias: {
      "~~": rootDir,
      "@@": rootDir,
      "~": resolve(rootDir, "app"),
      "@": resolve(rootDir, "app"),
    },
  },
})
