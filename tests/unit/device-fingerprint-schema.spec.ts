/**
 * Unit-тесты parseDeviceFingerprint / extractFingerprintFromConfig / withFingerprint.
 * Без zod — ручная валидация с дефолтами.
 */
import { describe, expect, it } from "vitest"
import {
  DEVICE_FINGERPRINT_DEFAULTS,
  extractFingerprintFromConfig,
  parseDeviceFingerprint,
  withFingerprint,
} from "../../shared/schemas/device-fingerprint"

describe("parseDeviceFingerprint", () => {
  it("returns defaults for null/undefined", () => {
    expect(parseDeviceFingerprint(null)).toEqual(DEVICE_FINGERPRINT_DEFAULTS)
    expect(parseDeviceFingerprint(undefined)).toEqual(DEVICE_FINGERPRINT_DEFAULTS)
    expect(parseDeviceFingerprint("not-an-object")).toEqual(DEVICE_FINGERPRINT_DEFAULTS)
  })

  it("merges valid fields with defaults", () => {
    const fp = parseDeviceFingerprint({ webrtc: "disabled", hardwareConcurrency: 16 })
    expect(fp.webrtc).toBe("disabled")
    expect(fp.hardwareConcurrency).toBe(16)
    expect(fp.canvas).toBe(DEVICE_FINGERPRINT_DEFAULTS.canvas)
  })

  it("ignores invalid enum values", () => {
    const fp = parseDeviceFingerprint({ webrtc: "invalid-mode", canvas: "weird" })
    expect(fp.webrtc).toBe(DEVICE_FINGERPRINT_DEFAULTS.webrtc)
    expect(fp.canvas).toBe(DEVICE_FINGERPRINT_DEFAULTS.canvas)
  })

  it("ignores non-positive hardwareConcurrency", () => {
    expect(parseDeviceFingerprint({ hardwareConcurrency: 0 }).hardwareConcurrency).toBe(
      DEVICE_FINGERPRINT_DEFAULTS.hardwareConcurrency,
    )
    expect(parseDeviceFingerprint({ hardwareConcurrency: -1 }).hardwareConcurrency).toBe(
      DEVICE_FINGERPRINT_DEFAULTS.hardwareConcurrency,
    )
  })

  it("accepts boolean touchEnabled", () => {
    expect(parseDeviceFingerprint({ touchEnabled: true }).touchEnabled).toBe(true)
    expect(parseDeviceFingerprint({ touchEnabled: false }).touchEnabled).toBe(false)
  })
})

describe("extractFingerprintFromConfig", () => {
  it("returns defaults when config has no fingerprint", () => {
    expect(extractFingerprintFromConfig({})).toEqual(DEVICE_FINGERPRINT_DEFAULTS)
    expect(extractFingerprintFromConfig(null)).toEqual(DEVICE_FINGERPRINT_DEFAULTS)
  })

  it("extracts fingerprint from config.fingerprint", () => {
    const fp = extractFingerprintFromConfig({
      fingerprint: { webrtc: "real", deviceMemory: 4 },
    })
    expect(fp.webrtc).toBe("real")
    expect(fp.deviceMemory).toBe(4)
  })
})

describe("withFingerprint", () => {
  it("preserves other config fields", () => {
    const newConfig = withFingerprint(
      { somethingElse: "keepme", fingerprint: { webrtc: "real" } },
      DEVICE_FINGERPRINT_DEFAULTS,
    )
    expect(newConfig.somethingElse).toBe("keepme")
    expect(newConfig.fingerprint).toEqual(DEVICE_FINGERPRINT_DEFAULTS)
  })

  it("creates new config when input is null", () => {
    const newConfig = withFingerprint(null, DEVICE_FINGERPRINT_DEFAULTS)
    expect(newConfig.fingerprint).toEqual(DEVICE_FINGERPRINT_DEFAULTS)
  })
})
