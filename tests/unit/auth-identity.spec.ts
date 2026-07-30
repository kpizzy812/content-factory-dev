import { describe, expect, it } from "vitest"

import { devExternalId } from "~~/server/utils/dev-auth"
import { localExternalId, normalizeEmail } from "~~/server/utils/auth/identity"

describe("local account identity", () => {
  it("приводит email к каноническому виду", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com")
  })

  it("выводит стабильный отрицательный externalId из email", () => {
    const first = localExternalId("owner@example.com")
    expect(first).toBe(localExternalId(" OWNER@example.com "))
    expect(first).toBeLessThan(0)
    expect(localExternalId("other@example.com")).not.toBe(first)
  })

  it("совпадает с dev-логином, чтобы одна почта не давала два аккаунта", () => {
    expect(localExternalId("owner@example.com")).toBe(devExternalId("owner@example.com"))
  })
})
