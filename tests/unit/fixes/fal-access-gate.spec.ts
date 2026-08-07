/**
 * Трактовка fal-preflight.
 * Дефект: probe_error (транзиентный сбой самой проверки) ронял весь запуск
 * генерации, хотя доступ к модели он не опровергает.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { isFalAccessBlocking, isFalProbeInconclusive } from "~~/server/utils/fal-access-gate"

describe("isFalAccessBlocking", () => {
  it("валит запуск только на однозначных вердиктах", () => {
    expect(isFalAccessBlocking("no_api_key")).toBe(true)
    expect(isFalAccessBlocking("blocked_by_access")).toBe(true)
  })

  it("не валит на available и на сбое проверки", () => {
    expect(isFalAccessBlocking("available")).toBe(false)
    expect(isFalAccessBlocking("probe_error")).toBe(false)
    expect(isFalAccessBlocking(undefined)).toBe(false)
    expect(isFalAccessBlocking(null)).toBe(false)
  })
})

describe("isFalProbeInconclusive", () => {
  it("probe_error — предупреждение, а не отказ", () => {
    expect(isFalProbeInconclusive("probe_error")).toBe(true)
  })

  it("available и блокирующие статусы предупреждением не считаются", () => {
    expect(isFalProbeInconclusive("available")).toBe(false)
    expect(isFalProbeInconclusive("no_api_key")).toBe(false)
    expect(isFalProbeInconclusive("blocked_by_access")).toBe(false)
    expect(isFalProbeInconclusive(undefined)).toBe(false)
  })
})
