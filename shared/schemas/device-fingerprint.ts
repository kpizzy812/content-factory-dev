/**
 * Device fingerprint — структура, хранимая в `DeviceProfile.config.fingerprint` (Json?).
 *
 * Архитектурное решение: в БД не добавляем явные колонки (webrtc, canvas, ...),
 * а кладём всё в `config Json?` под ключом `fingerprint`. Не требует миграции при
 * расширении. Под DuoPlus Android config переопределится в Этапе 3.
 *
 * Вместо `zod` (не установлен в проекте) — собственный validator. Возвращает
 * нормализованный объект с дефолтами для всех полей.
 */

export type DeviceWebrtcMode = "real" | "replace" | "disabled"
export type DeviceCanvasMode = "real" | "noise" | "off"
export type DeviceWebglMode = "real" | "noise" | "off"
export type DeviceAudioMode = "real" | "noise" | "off"

export interface DeviceFingerprint {
  webrtc: DeviceWebrtcMode
  canvas: DeviceCanvasMode
  webgl: DeviceWebglMode
  audio: DeviceAudioMode
  touchEnabled: boolean
  hardwareConcurrency: number
  deviceMemory: number
}

export const DEVICE_FINGERPRINT_DEFAULTS: DeviceFingerprint = {
  webrtc: "replace",
  canvas: "noise",
  webgl: "noise",
  audio: "real",
  touchEnabled: false,
  hardwareConcurrency: 8,
  deviceMemory: 8,
}

const WEBRTC_MODES: ReadonlySet<string> = new Set(["real", "replace", "disabled"])
const CANVAS_MODES: ReadonlySet<string> = new Set(["real", "noise", "off"])
const WEBGL_MODES: ReadonlySet<string> = new Set(["real", "noise", "off"])
const AUDIO_MODES: ReadonlySet<string> = new Set(["real", "noise", "off"])

/**
 * Парсит произвольный shape (например, из `DeviceProfile.config.fingerprint`)
 * в строго типизированный `DeviceFingerprint`. Невалидные поля заменяются дефолтами,
 * операция всегда успешна.
 */
export function parseDeviceFingerprint(input: unknown): DeviceFingerprint {
  if (!input || typeof input !== "object") return { ...DEVICE_FINGERPRINT_DEFAULTS }
  const obj = input as Record<string, unknown>

  const result: DeviceFingerprint = { ...DEVICE_FINGERPRINT_DEFAULTS }

  if (typeof obj.webrtc === "string" && WEBRTC_MODES.has(obj.webrtc)) {
    result.webrtc = obj.webrtc as DeviceWebrtcMode
  }
  if (typeof obj.canvas === "string" && CANVAS_MODES.has(obj.canvas)) {
    result.canvas = obj.canvas as DeviceCanvasMode
  }
  if (typeof obj.webgl === "string" && WEBGL_MODES.has(obj.webgl)) {
    result.webgl = obj.webgl as DeviceWebglMode
  }
  if (typeof obj.audio === "string" && AUDIO_MODES.has(obj.audio)) {
    result.audio = obj.audio as DeviceAudioMode
  }
  if (typeof obj.touchEnabled === "boolean") result.touchEnabled = obj.touchEnabled

  if (
    typeof obj.hardwareConcurrency === "number"
    && Number.isInteger(obj.hardwareConcurrency)
    && obj.hardwareConcurrency > 0
    && obj.hardwareConcurrency <= 256
  ) {
    result.hardwareConcurrency = obj.hardwareConcurrency
  }
  if (
    typeof obj.deviceMemory === "number"
    && Number.isInteger(obj.deviceMemory)
    && obj.deviceMemory > 0
    && obj.deviceMemory <= 1024
  ) {
    result.deviceMemory = obj.deviceMemory
  }

  return result
}

/**
 * Извлекает fingerprint из произвольного `config` (Json?) device-профиля.
 * Если поле отсутствует — возвращает defaults.
 */
export function extractFingerprintFromConfig(config: unknown): DeviceFingerprint {
  if (!config || typeof config !== "object") return { ...DEVICE_FINGERPRINT_DEFAULTS }
  const obj = config as Record<string, unknown>
  return parseDeviceFingerprint(obj.fingerprint)
}

/**
 * Создаёт новый config с обновлённым fingerprint, не теряя другие поля.
 */
export function withFingerprint(config: unknown, fingerprint: DeviceFingerprint): Record<string, unknown> {
  const base = config && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {}
  return { ...base, fingerprint }
}
