/**
 * Unit-тесты shared/data/device-presets — pure helper'ы parseResolution / suggestTimezone /
 * suggestLanguage и платформа defaults.
 *
 * Покрывает: smart watchers логику без mount настоящего <DeviceProfileEditModal>.
 * Если defaults меняются, тест ловит регрессию.
 */
import { describe, expect, it } from "vitest"
import {
  DEVICE_DEFAULTS_BY_PLATFORM,
  DEVICE_OS_BY_PLATFORM,
  DEVICE_RESOLUTIONS_BY_PLATFORM,
  isDesktopResolution,
  isMobileResolution,
  parseResolution,
  suggestLanguage,
  suggestTimezone,
} from "../../shared/data/device-presets"

describe("parseResolution", () => {
  it("parses 1920x1080", () => {
    expect(parseResolution("1920x1080")).toEqual({ width: 1920, height: 1080 })
  })
  it("parses 1920×1080 with multiplication sign", () => {
    expect(parseResolution("1920×1080")).toEqual({ width: 1920, height: 1080 })
  })
  it("returns null for empty/invalid input", () => {
    expect(parseResolution(null)).toBeNull()
    expect(parseResolution("")).toBeNull()
    expect(parseResolution("abc")).toBeNull()
    expect(parseResolution("1920x")).toBeNull()
  })
  it("returns null for negative or zero values", () => {
    expect(parseResolution("0x100")).toBeNull()
  })
})

describe("isDesktopResolution / isMobileResolution", () => {
  it("classifies desktop res", () => {
    expect(isDesktopResolution("1920x1080")).toBe(true)
    expect(isDesktopResolution("2560x1440")).toBe(true)
    expect(isMobileResolution("1920x1080")).toBe(false)
  })
  it("classifies mobile res", () => {
    expect(isMobileResolution("412x915")).toBe(true)
    expect(isMobileResolution("390x844")).toBe(true)
    expect(isDesktopResolution("412x915")).toBe(false)
  })
})

describe("suggestTimezone", () => {
  it("returns null for empty country", () => {
    expect(suggestTimezone(null)).toBeNull()
    expect(suggestTimezone("")).toBeNull()
  })
  it("maps US (no city) → America/New_York", () => {
    expect(suggestTimezone("US")).toBe("America/New_York")
  })
  it("maps US + Los Angeles → America/Los_Angeles", () => {
    expect(suggestTimezone("US", "Los Angeles")).toBe("America/Los_Angeles")
  })
  it("maps US + Chicago → America/Chicago", () => {
    expect(suggestTimezone("US", "Chicago")).toBe("America/Chicago")
  })
  it("maps US + unknown city → falls back to New York", () => {
    expect(suggestTimezone("US", "Unknown City")).toBe("America/New_York")
  })
  it("maps DE → Europe/Berlin", () => {
    expect(suggestTimezone("DE")).toBe("Europe/Berlin")
  })
  it("is case-insensitive on country code", () => {
    expect(suggestTimezone("us")).toBe("America/New_York")
    expect(suggestTimezone("Us")).toBe("America/New_York")
  })
})

describe("suggestLanguage", () => {
  it("returns en-US for US", () => {
    expect(suggestLanguage("US")).toBe("en-US")
  })
  it("returns de-DE for DE", () => {
    expect(suggestLanguage("DE")).toBe("de-DE")
  })
  it("returns null for unknown country", () => {
    expect(suggestLanguage("XX")).toBeNull()
  })
})

describe("DEVICE_DEFAULTS_BY_PLATFORM", () => {
  it("has all platform types with required keys", () => {
    for (const platform of ["desktop", "mobile_android", "mobile_ios"] as const) {
      const d = DEVICE_DEFAULTS_BY_PLATFORM[platform]
      expect(d).toBeDefined()
      expect(d.os).toBeTruthy()
      expect(d.resolution).toBeTruthy()
      expect(d.userAgent).toBeTruthy()
      expect(d.webrtc).toBeTruthy()
      expect(typeof d.touchEnabled).toBe("boolean")
      expect(d.hardwareConcurrency).toBeGreaterThan(0)
      expect(d.deviceMemory).toBeGreaterThan(0)
    }
  })

  it("desktop default has touchEnabled=false", () => {
    expect(DEVICE_DEFAULTS_BY_PLATFORM.desktop.touchEnabled).toBe(false)
  })

  it("mobile defaults have touchEnabled=true", () => {
    expect(DEVICE_DEFAULTS_BY_PLATFORM.mobile_android.touchEnabled).toBe(true)
    expect(DEVICE_DEFAULTS_BY_PLATFORM.mobile_ios.touchEnabled).toBe(true)
  })

  it("mobile_android UA mentions Android", () => {
    expect(DEVICE_DEFAULTS_BY_PLATFORM.mobile_android.userAgent).toContain("Android")
  })

  it("mobile_ios UA mentions iPhone", () => {
    expect(DEVICE_DEFAULTS_BY_PLATFORM.mobile_ios.userAgent).toContain("iPhone")
  })
})

describe("DEVICE_OS_BY_PLATFORM", () => {
  it("desktop options include Windows 11 and macOS", () => {
    const values = DEVICE_OS_BY_PLATFORM.desktop.map((o) => o.value)
    expect(values).toContain("Windows 11")
    expect(values.some((v) => v.startsWith("macOS"))).toBe(true)
  })
  it("mobile_android options only have Android values", () => {
    expect(DEVICE_OS_BY_PLATFORM.mobile_android.every((o) => o.value.startsWith("Android"))).toBe(true)
  })
  it("mobile_ios options only have iOS values", () => {
    expect(DEVICE_OS_BY_PLATFORM.mobile_ios.every((o) => o.value.startsWith("iOS"))).toBe(true)
  })
})

describe("DEVICE_RESOLUTIONS_BY_PLATFORM", () => {
  it("desktop has 1920x1080", () => {
    expect(DEVICE_RESOLUTIONS_BY_PLATFORM.desktop.map((r) => r.value)).toContain("1920x1080")
  })
  it("mobile_ios resolutions are all mobile-sized", () => {
    for (const r of DEVICE_RESOLUTIONS_BY_PLATFORM.mobile_ios) {
      expect(isMobileResolution(r.value)).toBe(true)
    }
  })
})
