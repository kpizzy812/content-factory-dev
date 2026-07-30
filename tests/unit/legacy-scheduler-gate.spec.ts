import { describe, expect, it } from "vitest"

import {
  isGoogleDriveSchedulerEnabled,
  isPostingWorkerEnabled,
  isProxyHealthCheckEnabled,
} from "~~/server/utils/legacy-scheduler"

describe("legacy scheduler gate", () => {
  it("не поднимает воркеры выключенных зон даже при старом флаге", () => {
    const env = {
      POSTING_WORKER_ENABLED: "true",
      PROXY_HEALTH_CHECK_ENABLED: "true",
      GOOGLE_DRIVE_SCHEDULER_ENABLED: "true",
    }
    expect(isPostingWorkerEnabled(env)).toBe(false)
    expect(isProxyHealthCheckEnabled(env)).toBe(false)
    expect(isGoogleDriveSchedulerEnabled(env)).toBe(false)
  })

  it("поднимает воркер, когда зона включена и старый флаг не выключен явно", () => {
    expect(isPostingWorkerEnabled({ LEGACY_DEVICE_AUTOMATION_ENABLED: "true" })).toBe(true)
    expect(isProxyHealthCheckEnabled({ LEGACY_PROXY_POOL_ENABLED: "true" })).toBe(true)
    expect(isGoogleDriveSchedulerEnabled({ LEGACY_GOOGLE_DRIVE_ENABLED: "true" })).toBe(true)
  })

  it("оставляет старым флагам право выключить воркер внутри включённой зоны", () => {
    expect(isPostingWorkerEnabled({
      LEGACY_DEVICE_AUTOMATION_ENABLED: "true",
      POSTING_WORKER_ENABLED: "false",
    })).toBe(false)
    expect(isProxyHealthCheckEnabled({
      LEGACY_PROXY_POOL_ENABLED: "true",
      PROXY_HEALTH_CHECK_ENABLED: "false",
    })).toBe(false)
    expect(isGoogleDriveSchedulerEnabled({
      LEGACY_GOOGLE_DRIVE_ENABLED: "true",
      GOOGLE_DRIVE_SCHEDULER_ENABLED: "false",
    })).toBe(false)
  })

  it("на пустом окружении не поднимает ничего", () => {
    expect(isPostingWorkerEnabled({})).toBe(false)
    expect(isProxyHealthCheckEnabled({})).toBe(false)
    expect(isGoogleDriveSchedulerEnabled({})).toBe(false)
  })
})
