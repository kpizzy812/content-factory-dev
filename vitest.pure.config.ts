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
    include: [
      "tests/unit/replicate/**/*.spec.ts",
      "tests/unit/media-provider/**/*.spec.ts",
      "tests/unit/lip-sync-provider.spec.ts",
      "tests/unit/content-factory-*.spec.ts",
      "tests/unit/content-quality-gate.spec.ts",
      "tests/unit/content-strategy-agent.spec.ts",
      "tests/unit/scenario-marketing-validator-language.spec.ts",
      "tests/unit/scene-budget.spec.ts",
      "tests/unit/dev-auth.spec.ts",
      "tests/unit/legacy-modules.spec.ts",
      "tests/unit/legacy-scheduler-gate.spec.ts",
      "tests/unit/legacy-navigation-contract.spec.ts",
      "tests/unit/auth-password.spec.ts",
      "tests/unit/auth-identity.spec.ts",
      "tests/unit/auth-provider.spec.ts",
      "tests/unit/presenter-segment-planner.spec.ts",
      "tests/unit/presenter-perceptual-hash.spec.ts",
      "tests/unit/presenter-ingest-runner.spec.ts",
    ],
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
