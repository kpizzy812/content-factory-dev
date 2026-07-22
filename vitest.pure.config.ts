import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const rootDir = dirname(fileURLToPath(import.meta.url))

/**
 * Fast DB-free tests for pure provider and orchestration logic.
 * Integration/API suites continue to use vitest.config.ts with the real test DB.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    include: ["tests/unit/replicate/**/*.spec.ts", "tests/unit/media-provider/**/*.spec.ts"],
    exclude: ["node_modules/**", ".nuxt/**", ".output/**"],
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
