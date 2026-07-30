import { describe, expect, it } from "vitest"

import {
  isLegacyPathBlocked,
  LEGACY_MODULE_IDS,
  readLegacyModules,
} from "~~/shared/utils/legacy-modules"

describe("legacy module map", () => {
  it("выключает все унаследованные зоны по умолчанию", () => {
    const modules = readLegacyModules({})
    for (const id of LEGACY_MODULE_IDS) {
      expect(modules[id]).toBe(false)
    }
  })

  it("включает зону только точным значением true", () => {
    expect(readLegacyModules({ LEGACY_DEVICE_AUTOMATION_ENABLED: "true" }).deviceAutomation).toBe(true)
    expect(readLegacyModules({ LEGACY_DEVICE_AUTOMATION_ENABLED: "1" }).deviceAutomation).toBe(false)
    expect(readLegacyModules({ LEGACY_DEVICE_AUTOMATION_ENABLED: "TRUE" }).deviceAutomation).toBe(false)
    expect(readLegacyModules({ LEGACY_PROXY_POOL_ENABLED: "true" }).proxyPool).toBe(true)
    expect(readLegacyModules({ LEGACY_GOOGLE_DRIVE_ENABLED: "true" }).googleDrive).toBe(true)
    expect(readLegacyModules({ LEGACY_MARKETING_CAMP_SYNC_ENABLED: "true" }).marketingCampSync).toBe(true)
  })

  it("блокирует пути выключенных зон и пропускает включённые", () => {
    const allOff = readLegacyModules({})
    expect(isLegacyPathBlocked("/api/device-profiles", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/posting-jobs/42/cancel", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/warmup/sessions", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/proxies/7/reveal", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/google-drive", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/ideas/sync/export", allOff)).toBe(true)

    const proxyOn = readLegacyModules({ LEGACY_PROXY_POOL_ENABLED: "true" })
    expect(isLegacyPathBlocked("/api/proxies/7/reveal", proxyOn)).toBe(false)
  })

  it("не трогает пути фабрики и соседние префиксы", () => {
    const allOff = readLegacyModules({})
    expect(isLegacyPathBlocked("/api/factory/batches", allOff)).toBe(false)
    expect(isLegacyPathBlocked("/api/videos/12", allOff)).toBe(false)
    expect(isLegacyPathBlocked("/api/ideas", allOff)).toBe(false)
    expect(isLegacyPathBlocked("/api/ideas/12", allOff)).toBe(false)
    expect(isLegacyPathBlocked("/api/proxies-report", allOff)).toBe(false)
  })

  it("игнорирует query string при сопоставлении пути", () => {
    const allOff = readLegacyModules({})
    expect(isLegacyPathBlocked("/api/proxies?page=2", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/videos?proxyId=3", allOff)).toBe(false)
  })
})
