/**
 * Unit-тесты для US-proxy guard helpers (Цикл M.4).
 *
 * computeUsProxyGuard — pure, без БД. Покрывает все 4 ветки enum.
 * assertUsProxyGuard — throw 412 при не-US, pass для "us_proxy_ok".
 */
import { describe, expect, it } from "vitest"
import {
  computeUsProxyGuard,
  assertUsProxyGuard,
} from "../../server/utils/posting-provider/us-proxy-guard"

describe("computeUsProxyGuard", () => {
  it("returns 'no_proxy' when proxy is null/undefined", () => {
    expect(computeUsProxyGuard(null)).toBe("no_proxy")
    expect(computeUsProxyGuard(undefined)).toBe("no_proxy")
  })

  it("returns 'us_proxy_ok' when expectedCountry === 'US'", () => {
    expect(computeUsProxyGuard({ id: "p1", expectedCountry: "US" })).toBe("us_proxy_ok")
  })

  it("returns 'unknown' when expectedCountry is null/empty", () => {
    expect(computeUsProxyGuard({ id: "p1", expectedCountry: null })).toBe("unknown")
    expect(computeUsProxyGuard({ id: "p1", expectedCountry: "" })).toBe("unknown")
    expect(computeUsProxyGuard({ id: "p1", expectedCountry: undefined })).toBe("unknown")
  })

  it("returns 'wrong_country' for non-US countries", () => {
    expect(computeUsProxyGuard({ id: "p1", expectedCountry: "DE" })).toBe("wrong_country")
    expect(computeUsProxyGuard({ id: "p1", expectedCountry: "RU" })).toBe("wrong_country")
    expect(computeUsProxyGuard({ id: "p1", expectedCountry: "us" })).toBe("wrong_country") // case-sensitive
  })
})

describe("assertUsProxyGuard", () => {
  it("passes silently when US proxy", () => {
    expect(() =>
      assertUsProxyGuard({
        profileId: "profile-1",
        proxy: { id: "p1", expectedCountry: "US" },
      }),
    ).not.toThrow()
  })

  it("throws 412 with code='no_proxy' when no proxy", () => {
    expect(() =>
      assertUsProxyGuard({ profileId: "profile-1", proxy: null }),
    ).toThrow(
      expect.objectContaining({ statusCode: 412 }) as unknown as Error,
    )
  })

  it("throws 412 with code='wrong_country' when non-US", () => {
    try {
      assertUsProxyGuard({
        profileId: "profile-1",
        proxy: { id: "p1", expectedCountry: "DE" },
      })
      expect.fail("should throw")
    } catch (e: unknown) {
      const err = e as { statusCode?: number; data?: { code?: string; actualCountry?: string } }
      expect(err.statusCode).toBe(412)
      expect(err.data?.code).toBe("wrong_country")
      expect(err.data?.actualCountry).toBe("DE")
    }
  })

  it("throws 412 with code='unknown' when expectedCountry not set", () => {
    try {
      assertUsProxyGuard({
        profileId: "profile-1",
        proxy: { id: "p1", expectedCountry: null },
      })
      expect.fail("should throw")
    } catch (e: unknown) {
      const err = e as { statusCode?: number; data?: { code?: string } }
      expect(err.statusCode).toBe(412)
      expect(err.data?.code).toBe("unknown")
    }
  })
})
