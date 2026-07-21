/**
 * Unit-тесты shared/data/device-hardware-presets — pure helpers без mount компонентов.
 *
 * Покрываем:
 * - applyDevicePreset() возвращает корректные form fields для разных device типов.
 * - buildUserAgent() подставляет placeholders корректно.
 * - findPresetById() handle valid / invalid id.
 * - groupPresetsByBrand() сортирует popular-first → year-desc.
 * - extract/withDevicePresetId() round-trip через config Json.
 *
 * Регрессии (если specs изменены случайно):
 * - iOS hardwareConcurrency = 2 (WebKit cap)
 * - macOS UA frozen на 10_15_7
 * - Galaxy S24 viewport 360×780 (одинаковый с S22/S23)
 */
import { describe, expect, it } from "vitest"
import {
  DEVICE_HARDWARE_PRESETS,
  applyDevicePreset,
  buildUserAgent,
  extractDevicePresetIdFromConfig,
  findPresetById,
  groupPresetsByBrand,
  withDevicePresetId,
} from "../../shared/data/device-hardware-presets"
import {
  DEVICE_OS_BY_PLATFORM,
  DEVICE_RESOLUTIONS_BY_PLATFORM,
} from "../../shared/data/device-presets"

describe("DEVICE_HARDWARE_PRESETS", () => {
  it("contains 17+ devices", () => {
    expect(DEVICE_HARDWARE_PRESETS.length).toBeGreaterThanOrEqual(17)
  })

  it("has unique ids", () => {
    const ids = DEVICE_HARDWARE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("ids follow snake_case_year pattern", () => {
    for (const preset of DEVICE_HARDWARE_PRESETS) {
      expect(preset.id).toMatch(/^[a-z0-9_]+$/)
    }
  })

  it("all iOS presets have hardwareConcurrency=2 (WebKit cap)", () => {
    const iosPresets = DEVICE_HARDWARE_PRESETS.filter((p) => p.category === "mobile_ios")
    expect(iosPresets.length).toBeGreaterThan(0)
    for (const preset of iosPresets) {
      expect(preset.hardwareConcurrency).toBe(2)
    }
  })

  it("all mobile presets have touchEnabled=true", () => {
    const mobilePresets = DEVICE_HARDWARE_PRESETS.filter(
      (p) => p.category === "mobile_ios" || p.category === "mobile_android",
    )
    for (const preset of mobilePresets) {
      expect(preset.touchEnabled).toBe(true)
    }
  })

  it("all desktop presets have touchEnabled=false", () => {
    const desktops = DEVICE_HARDWARE_PRESETS.filter((p) => p.category === "desktop")
    for (const preset of desktops) {
      expect(preset.touchEnabled).toBe(false)
    }
  })

  it("Galaxy S22/S23/S24 share 360x780 CSS viewport", () => {
    const ids = ["galaxy_s22_2022", "galaxy_s23_2023", "galaxy_s24_2024"]
    for (const id of ids) {
      const preset = findPresetById(id)
      expect(preset?.screenWidth).toBe(360)
      expect(preset?.screenHeight).toBe(780)
    }
  })

  it("MacBook Pro 14 M3 uses 1512x982 (not 16-inch's 1728x1117)", () => {
    const mbp = findPresetById("macbook_pro_m3_14_2023")
    expect(mbp?.screenWidth).toBe(1512)
    expect(mbp?.screenHeight).toBe(982)
  })
})

describe("applyDevicePreset", () => {
  it("iPhone 15 Pro → mobile_ios + iOS 17 + 393x852 + touch + 2 cores", () => {
    const preset = findPresetById("iphone_15_pro_2023")!
    const applied = applyDevicePreset(preset)
    expect(applied.platformType).toBe("mobile_ios")
    expect(applied.os).toBe("iOS 17")
    expect(applied.screenResolution).toBe("393x852")
    expect(applied.fingerprint.touchEnabled).toBe(true)
    expect(applied.fingerprint.hardwareConcurrency).toBe(2)
    expect(applied.fingerprint.deviceMemory).toBe(8)
    expect(applied.userAgent).toContain("iPhone")
    expect(applied.userAgent).toContain("Version/17.6")
    expect(applied.userAgent).not.toContain("{os_version}")
    expect(applied.userAgent).not.toContain("{safari_version}")
  })

  it("Galaxy S24 → mobile_android + Android 14 + 360x780 + touch + 8 cores", () => {
    const preset = findPresetById("galaxy_s24_2024")!
    const applied = applyDevicePreset(preset)
    expect(applied.platformType).toBe("mobile_android")
    expect(applied.os).toBe("Android 14")
    expect(applied.screenResolution).toBe("360x780")
    expect(applied.fingerprint.touchEnabled).toBe(true)
    expect(applied.fingerprint.hardwareConcurrency).toBe(8)
    expect(applied.fingerprint.deviceMemory).toBe(8)
    expect(applied.userAgent).toContain("Android 14")
    expect(applied.userAgent).toContain("Chrome/")
    expect(applied.userAgent).not.toContain("{android_version}")
    expect(applied.userAgent).not.toContain("{chrome_version}")
  })

  it("Windows 11 Laptop → desktop + 1920x1080 + no touch", () => {
    const preset = findPresetById("windows_laptop_1080p")!
    const applied = applyDevicePreset(preset)
    expect(applied.platformType).toBe("desktop")
    expect(applied.os).toBe("Windows 11")
    expect(applied.screenResolution).toBe("1920x1080")
    expect(applied.fingerprint.touchEnabled).toBe(false)
    expect(applied.userAgent).toContain("Windows NT 10.0")
    expect(applied.userAgent).toContain("Chrome/")
  })

  it("MacBook Pro M3 → UA uses frozen 10_15_7 macOS string", () => {
    const preset = findPresetById("macbook_pro_m3_14_2023")!
    const applied = applyDevicePreset(preset)
    expect(applied.userAgent).toContain("Intel Mac OS X 10_15_7")
    expect(applied.fingerprint.hardwareConcurrency).toBe(12)
  })

  it("anti-detect fingerprint defaults applied (replace/noise/noise/real)", () => {
    const preset = findPresetById("iphone_15_pro_2023")!
    const applied = applyDevicePreset(preset)
    expect(applied.fingerprint.webrtc).toBe("replace")
    expect(applied.fingerprint.canvas).toBe("noise")
    expect(applied.fingerprint.webgl).toBe("noise")
    expect(applied.fingerprint.audio).toBe("real")
  })
})

describe("buildUserAgent", () => {
  it("substitutes iOS placeholders", () => {
    const preset = findPresetById("iphone_15_pro_2023")!
    const ua = buildUserAgent(preset, "iOS 18")
    expect(ua).toContain("iPhone OS 18_0")
    expect(ua).toContain("Version/18.0")
    expect(ua).not.toContain("{")
  })

  it("substitutes Android placeholders", () => {
    const preset = findPresetById("galaxy_s24_2024")!
    const ua = buildUserAgent(preset, "Android 14")
    expect(ua).toContain("Android 14")
    expect(ua).toContain("Chrome/")
    expect(ua).not.toContain("{")
  })

  it("substitutes Windows Chrome version", () => {
    const preset = findPresetById("windows_laptop_1080p")!
    const ua = buildUserAgent(preset, "Windows 11")
    expect(ua).toMatch(/Chrome\/\d+\.\d+\.\d+\.\d+/)
    expect(ua).not.toContain("{")
  })
})

describe("findPresetById", () => {
  it("returns preset for valid id", () => {
    expect(findPresetById("iphone_15_pro_2023")?.model).toBe("iPhone 15 Pro")
  })

  it("returns null for unknown id", () => {
    expect(findPresetById("nonexistent_device")).toBeNull()
  })

  it("returns null for null/empty input", () => {
    expect(findPresetById(null)).toBeNull()
    expect(findPresetById(undefined)).toBeNull()
    expect(findPresetById("")).toBeNull()
  })
})

describe("groupPresetsByBrand", () => {
  it("groups by brand", () => {
    const groups = groupPresetsByBrand()
    const brands = groups.map((g) => g.brand)
    expect(brands).toContain("Apple")
    expect(brands).toContain("Samsung")
    expect(brands).toContain("Google")
    expect(brands).toContain("Generic")
  })

  it("sorts popular presets first within group", () => {
    const groups = groupPresetsByBrand()
    for (const group of groups) {
      let seenNonPopular = false
      for (const preset of group.presets) {
        if (!preset.popular) seenNonPopular = true
        if (preset.popular && seenNonPopular) {
          throw new Error(
            `Popular preset ${preset.id} appears after non-popular in ${group.brand}`,
          )
        }
      }
    }
  })

  it("sorts by year descending within same popularity", () => {
    const apple = groupPresetsByBrand().find((g) => g.brand === "Apple")!
    const popularApple = apple.presets.filter((p) => p.popular)
    for (let i = 1; i < popularApple.length; i++) {
      expect(popularApple[i - 1]!.year).toBeGreaterThanOrEqual(popularApple[i]!.year)
    }
  })

  it("includes all presets across groups", () => {
    const totalInGroups = groupPresetsByBrand().reduce((sum, g) => sum + g.presets.length, 0)
    expect(totalInGroups).toBe(DEVICE_HARDWARE_PRESETS.length)
  })
})

describe("preset values match form dropdown options", () => {
  // Если эта инвариантa нарушена — <select> в форме не сможет показать значение
  // после apply preset, и пользователь увидит пустой dropdown.
  it("every preset resolution exists in DEVICE_RESOLUTIONS_BY_PLATFORM", () => {
    for (const preset of DEVICE_HARDWARE_PRESETS) {
      const resValue = `${preset.screenWidth}x${preset.screenHeight}`
      const dropdownValues = DEVICE_RESOLUTIONS_BY_PLATFORM[preset.category].map(
        (r) => r.value,
      )
      expect(dropdownValues, `preset ${preset.id} (${resValue})`).toContain(resValue)
    }
  })

  it("every preset osDefault exists in DEVICE_OS_BY_PLATFORM", () => {
    for (const preset of DEVICE_HARDWARE_PRESETS) {
      const dropdownValues = DEVICE_OS_BY_PLATFORM[preset.category].map((o) => o.value)
      expect(dropdownValues, `preset ${preset.id} (${preset.osDefault})`).toContain(
        preset.osDefault,
      )
    }
  })
})

describe("extract/withDevicePresetId config helpers", () => {
  it("round-trip: set + extract", () => {
    const config = withDevicePresetId(null, "iphone_15_pro_2023")
    expect(extractDevicePresetIdFromConfig(config)).toBe("iphone_15_pro_2023")
  })

  it("withDevicePresetId(null) removes the key", () => {
    const withId = withDevicePresetId(null, "galaxy_s24_2024")
    const cleared = withDevicePresetId(withId, null)
    expect(extractDevicePresetIdFromConfig(cleared)).toBeNull()
    expect(Object.keys(cleared)).not.toContain("devicePresetId")
  })

  it("preserves other config keys (fingerprint)", () => {
    const baseConfig = { fingerprint: { webrtc: "replace" } }
    const updated = withDevicePresetId(baseConfig, "pixel_8_2023")
    expect((updated as Record<string, unknown>).fingerprint).toEqual({ webrtc: "replace" })
    expect(extractDevicePresetIdFromConfig(updated)).toBe("pixel_8_2023")
  })

  it("extract returns null for missing/invalid config", () => {
    expect(extractDevicePresetIdFromConfig(null)).toBeNull()
    expect(extractDevicePresetIdFromConfig(undefined)).toBeNull()
    expect(extractDevicePresetIdFromConfig({})).toBeNull()
    expect(extractDevicePresetIdFromConfig({ devicePresetId: 123 })).toBeNull()
    expect(extractDevicePresetIdFromConfig({ devicePresetId: "" })).toBeNull()
  })
})
