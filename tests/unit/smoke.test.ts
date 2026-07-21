/**
 * Unit smoke-test: проверяем что Vitest стартует и базовая логика работает.
 * Не лезет ни в БД, ни в Nuxt — чистый node-env.
 */
import { describe, it, expect } from "vitest"

describe("vitest smoke", () => {
  it("математика 1+1=2", () => {
    expect(1 + 1).toBe(2)
  })

  it("setup корректно загрузил .env.test", () => {
    expect(process.env.NODE_ENV).toBe("test")
    expect(process.env.TEST_AUTH_TOKEN).toBeTruthy()
  })
})
