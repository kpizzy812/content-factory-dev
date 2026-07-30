import { describe, expect, it } from "vitest"

import { resolveAuthProvider } from "~~/server/utils/auth/provider"

describe("auth provider selection", () => {
  it("по умолчанию использует локальную авторизацию", () => {
    expect(resolveAuthProvider({})).toBe("local")
    expect(resolveAuthProvider({ AUTH_PROVIDER: "" })).toBe("local")
  })

  it("включает MarketingCamp только явно", () => {
    expect(resolveAuthProvider({ AUTH_PROVIDER: "marketingcamp" })).toBe("marketingcamp")
    expect(resolveAuthProvider({ AUTH_PROVIDER: "MarketingCamp" })).toBe("marketingcamp")
  })

  it("падает на неизвестном значении, а не молча откатывается", () => {
    expect(() => resolveAuthProvider({ AUTH_PROVIDER: "ldap" })).toThrow(/AUTH_PROVIDER/)
  })
})
