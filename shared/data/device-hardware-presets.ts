/**
 * Device hardware presets — реальные specs для autofill формы.
 *
 * Operator выбирает конкретное устройство (iPhone 15 Pro 2023), вместо того чтобы
 * вручную заполнять каждое поле. Все specs verified через web research:
 * см. `.claude/agent-memory/architect/indigo_device_presets_research.md`.
 *
 * Ключевые правила (нарушение → detection rate ↑):
 * - **iOS hardwareConcurrency = 2** (WebKit cap, не физические ядра A-chips).
 * - **iOS deviceMemory** API недоступен — здесь храним physical RAM как hint
 *   (будет передан провайдеру но реально браузер на iOS вернёт undefined).
 * - **Galaxy S22/S23/S24** имеют одинаковый CSS viewport 360×780 — это реальность.
 * - **MacBook Pro 14" M3** = 1512×982 (1728×1117 — это 16", не 14").
 * - **macOS UA frozen** на `Intel Mac OS X 10_15_7` (Apple/Google anti-fingerprinting).
 *
 * Резолюции записаны в логических CSS пикселях (то что reportит браузер),
 * не в physical pixels — это совместимо с parseResolution() и sanity-panel.
 */

import type { DevicePlatformType } from "~~/shared/types/device-profile"
import type { DeviceFingerprint } from "~~/shared/schemas/device-fingerprint"

export type DevicePresetCategory = DevicePlatformType

export interface DevicePreset {
  id: string
  brand: "Apple" | "Samsung" | "Google" | "Generic"
  model: string
  year: number
  category: DevicePresetCategory

  screenWidth: number
  screenHeight: number
  pixelRatio: number

  osMin: string
  osDefault: string
  osLatest: string

  hardwareConcurrency: number
  deviceMemory: number

  userAgentTemplate: string

  touchEnabled: boolean

  popular?: boolean
  notes?: string
  imageEmoji?: string
}

// =====================================================================
// Substitution values for UA templates
// =====================================================================

// Stable browser versions chosen as defaults for UA generation.
// Update yearly or when target detection profiles change.
const DEFAULT_CHROME_VERSION = "131.0.0.0"
const DEFAULT_SAFARI_VERSION_BY_IOS: Record<string, string> = {
  "iOS 15": "15.6",
  "iOS 16": "16.6",
  "iOS 17": "17.6",
  "iOS 18": "18.0",
}

// iOS version в UA пишется в формате "17_6", "18_0", etc.
function iosUaVersion(osLabel: string): string {
  // 'iOS 18' → '18_0'
  const m = osLabel.match(/iOS\s+(\d+)/i)
  if (!m) return "17_0"
  return `${m[1]}_0`
}

function safariVersion(osLabel: string): string {
  return DEFAULT_SAFARI_VERSION_BY_IOS[osLabel] ?? "17.0"
}

function androidUaVersion(osLabel: string): string {
  // 'Android 14' → '14'
  const m = osLabel.match(/Android\s+(\d+)/i)
  return m?.[1] ?? "14"
}

// =====================================================================
// PRESETS
// =====================================================================

export const DEVICE_HARDWARE_PRESETS: readonly DevicePreset[] = [
  // ── Apple iPhone ──────────────────────────────────────────────────
  {
    id: "iphone_13_2021",
    brand: "Apple",
    model: "iPhone 13",
    year: 2021,
    category: "mobile_ios",
    screenWidth: 390,
    screenHeight: 844,
    pixelRatio: 3,
    osMin: "iOS 15",
    osDefault: "iOS 17",
    osLatest: "iOS 18",
    hardwareConcurrency: 2,
    deviceMemory: 4,
    userAgentTemplate:
      "Mozilla/5.0 (iPhone; CPU iPhone OS {os_version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{safari_version} Mobile/15E148 Safari/604.1",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },
  {
    id: "iphone_14_2022",
    brand: "Apple",
    model: "iPhone 14",
    year: 2022,
    category: "mobile_ios",
    screenWidth: 390,
    screenHeight: 844,
    pixelRatio: 3,
    osMin: "iOS 16",
    osDefault: "iOS 17",
    osLatest: "iOS 18",
    hardwareConcurrency: 2,
    deviceMemory: 6,
    userAgentTemplate:
      "Mozilla/5.0 (iPhone; CPU iPhone OS {os_version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{safari_version} Mobile/15E148 Safari/604.1",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },
  {
    id: "iphone_14_pro_2022",
    brand: "Apple",
    model: "iPhone 14 Pro",
    year: 2022,
    category: "mobile_ios",
    screenWidth: 390,
    screenHeight: 844,
    pixelRatio: 3,
    osMin: "iOS 16",
    osDefault: "iOS 17",
    osLatest: "iOS 18",
    hardwareConcurrency: 2,
    deviceMemory: 6,
    userAgentTemplate:
      "Mozilla/5.0 (iPhone; CPU iPhone OS {os_version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{safari_version} Mobile/15E148 Safari/604.1",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },
  {
    id: "iphone_15_2023",
    brand: "Apple",
    model: "iPhone 15",
    year: 2023,
    category: "mobile_ios",
    screenWidth: 393,
    screenHeight: 852,
    pixelRatio: 3,
    osMin: "iOS 17",
    osDefault: "iOS 17",
    osLatest: "iOS 18",
    hardwareConcurrency: 2,
    deviceMemory: 6,
    userAgentTemplate:
      "Mozilla/5.0 (iPhone; CPU iPhone OS {os_version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{safari_version} Mobile/15E148 Safari/604.1",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },
  {
    id: "iphone_15_pro_2023",
    brand: "Apple",
    model: "iPhone 15 Pro",
    year: 2023,
    category: "mobile_ios",
    screenWidth: 393,
    screenHeight: 852,
    pixelRatio: 3,
    osMin: "iOS 17",
    osDefault: "iOS 17",
    osLatest: "iOS 18",
    hardwareConcurrency: 2,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (iPhone; CPU iPhone OS {os_version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{safari_version} Mobile/15E148 Safari/604.1",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },
  {
    id: "iphone_16_pro_2024",
    brand: "Apple",
    model: "iPhone 16 Pro",
    year: 2024,
    category: "mobile_ios",
    screenWidth: 402,
    screenHeight: 874,
    pixelRatio: 3,
    osMin: "iOS 18",
    osDefault: "iOS 18",
    osLatest: "iOS 18",
    hardwareConcurrency: 2,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (iPhone; CPU iPhone OS {os_version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{safari_version} Mobile/15E148 Safari/604.1",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },

  // ── Samsung Galaxy ────────────────────────────────────────────────
  {
    id: "galaxy_s22_2022",
    brand: "Samsung",
    model: "Galaxy S22",
    year: 2022,
    category: "mobile_android",
    screenWidth: 360,
    screenHeight: 780,
    pixelRatio: 3,
    osMin: "Android 12",
    osDefault: "Android 14",
    osLatest: "Android 14",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Linux; Android {android_version}; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Mobile Safari/537.36",
    touchEnabled: true,
    imageEmoji: "📱",
  },
  {
    id: "galaxy_s23_2023",
    brand: "Samsung",
    model: "Galaxy S23",
    year: 2023,
    category: "mobile_android",
    screenWidth: 360,
    screenHeight: 780,
    pixelRatio: 3,
    osMin: "Android 13",
    osDefault: "Android 14",
    osLatest: "Android 14",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Linux; Android {android_version}; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Mobile Safari/537.36",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },
  {
    id: "galaxy_s24_2024",
    brand: "Samsung",
    model: "Galaxy S24",
    year: 2024,
    category: "mobile_android",
    screenWidth: 360,
    screenHeight: 780,
    pixelRatio: 3,
    osMin: "Android 14",
    osDefault: "Android 14",
    osLatest: "Android 14",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Linux; Android {android_version}; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Mobile Safari/537.36",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },
  {
    id: "galaxy_s24_ultra_2024",
    brand: "Samsung",
    model: "Galaxy S24 Ultra",
    year: 2024,
    category: "mobile_android",
    screenWidth: 384,
    screenHeight: 824,
    pixelRatio: 3.75,
    osMin: "Android 14",
    osDefault: "Android 14",
    osLatest: "Android 14",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Linux; Android {android_version}; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Mobile Safari/537.36",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },

  // ── Google Pixel ──────────────────────────────────────────────────
  {
    id: "pixel_8_2023",
    brand: "Google",
    model: "Pixel 8",
    year: 2023,
    category: "mobile_android",
    screenWidth: 412,
    screenHeight: 915,
    pixelRatio: 2.625,
    osMin: "Android 14",
    osDefault: "Android 14",
    osLatest: "Android 14",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Linux; Android {android_version}; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Mobile Safari/537.36",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },
  {
    id: "pixel_8_pro_2023",
    brand: "Google",
    model: "Pixel 8 Pro",
    year: 2023,
    category: "mobile_android",
    screenWidth: 448,
    screenHeight: 998,
    pixelRatio: 3,
    osMin: "Android 14",
    osDefault: "Android 14",
    osLatest: "Android 14",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Linux; Android {android_version}; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Mobile Safari/537.36",
    touchEnabled: true,
    imageEmoji: "📱",
  },
  {
    id: "pixel_9_pro_2024",
    brand: "Google",
    model: "Pixel 9 Pro",
    year: 2024,
    category: "mobile_android",
    screenWidth: 412,
    screenHeight: 915,
    pixelRatio: 3.5,
    osMin: "Android 14",
    osDefault: "Android 14",
    osLatest: "Android 14",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Linux; Android {android_version}; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Mobile Safari/537.36",
    touchEnabled: true,
    popular: true,
    imageEmoji: "📱",
  },

  // ── Desktop ───────────────────────────────────────────────────────
  {
    id: "windows_laptop_1080p",
    brand: "Generic",
    model: "Windows 11 Laptop",
    year: 2024,
    category: "desktop",
    screenWidth: 1920,
    screenHeight: 1080,
    pixelRatio: 1,
    osMin: "Windows 10",
    osDefault: "Windows 11",
    osLatest: "Windows 11",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Safari/537.36",
    touchEnabled: false,
    popular: true,
    imageEmoji: "💻",
  },
  {
    id: "windows_desktop_1440p",
    brand: "Generic",
    model: "Windows 11 Desktop QHD",
    year: 2024,
    category: "desktop",
    screenWidth: 2560,
    screenHeight: 1440,
    pixelRatio: 1,
    osMin: "Windows 10",
    osDefault: "Windows 11",
    osLatest: "Windows 11",
    hardwareConcurrency: 16,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Safari/537.36",
    touchEnabled: false,
    imageEmoji: "🖥️",
  },
  {
    id: "macbook_air_m2_2022",
    brand: "Apple",
    model: "MacBook Air M2 13\"",
    year: 2022,
    category: "desktop",
    screenWidth: 1470,
    screenHeight: 956,
    pixelRatio: 2,
    osMin: "macOS 12",
    osDefault: "macOS 14",
    osLatest: "macOS 14",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Safari/537.36",
    touchEnabled: false,
    popular: true,
    imageEmoji: "💻",
  },
  {
    id: "macbook_pro_m3_14_2023",
    brand: "Apple",
    model: "MacBook Pro 14\" M3",
    year: 2023,
    category: "desktop",
    screenWidth: 1512,
    screenHeight: 982,
    pixelRatio: 2,
    osMin: "macOS 14",
    osDefault: "macOS 14",
    osLatest: "macOS 14",
    hardwareConcurrency: 12,
    deviceMemory: 8,
    userAgentTemplate:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_version} Safari/537.36",
    touchEnabled: false,
    imageEmoji: "💻",
  },
] as const

// =====================================================================
// HELPERS
// =====================================================================

export interface AppliedDevicePreset {
  platformType: DevicePlatformType
  os: string
  screenResolution: string
  userAgent: string
  fingerprint: DeviceFingerprint
}

/**
 * Подставляет placeholders в UA template на основе OS/category.
 * Поддерживает: {os_version}, {safari_version}, {android_version}, {chrome_version}.
 *
 * Все unknown placeholders остаются как есть — это намеренно (легче замечать
 * неполные шаблоны на code review).
 */
export function buildUserAgent(preset: DevicePreset, os: string): string {
  let ua = preset.userAgentTemplate
  if (preset.category === "mobile_ios" || (preset.brand === "Apple" && preset.category === "desktop")) {
    ua = ua.replace("{os_version}", iosUaVersion(os))
    ua = ua.replace("{safari_version}", safariVersion(os))
  }
  if (preset.category === "mobile_android") {
    ua = ua.replace("{android_version}", androidUaVersion(os))
  }
  ua = ua.replace("{chrome_version}", DEFAULT_CHROME_VERSION)
  return ua
}

/**
 * Применяет preset → возвращает структурированные поля для form state.
 *
 * Anti-detect modes (webrtc/canvas/webgl/audio) берутся из текущих defaults
 * fingerprint-схемы — это намерение анти-детекта, не characteristic устройства.
 * Operator может override после apply.
 */
export function applyDevicePreset(preset: DevicePreset): AppliedDevicePreset {
  const os = preset.osDefault
  return {
    platformType: preset.category,
    os,
    screenResolution: `${preset.screenWidth}x${preset.screenHeight}`,
    userAgent: buildUserAgent(preset, os),
    fingerprint: {
      webrtc: "replace",
      canvas: "noise",
      webgl: "noise",
      audio: "real",
      touchEnabled: preset.touchEnabled,
      hardwareConcurrency: preset.hardwareConcurrency,
      deviceMemory: preset.deviceMemory,
    },
  }
}

/**
 * Найти preset по id. Возвращает null если не найден (preset удалён из таблицы
 * или id невалиден). UI должен этот case обработать (preset selector покажет
 * "Custom" вместо несуществующего).
 */
export function findPresetById(id: string | null | undefined): DevicePreset | null {
  if (!id) return null
  return DEVICE_HARDWARE_PRESETS.find((p) => p.id === id) ?? null
}

/**
 * Извлекает `devicePresetId` из `DeviceProfile.config` (Json?).
 * Возвращает null если поле отсутствует или невалидно (UI откатится в Custom).
 */
export function extractDevicePresetIdFromConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") return null
  const value = (config as Record<string, unknown>).devicePresetId
  if (typeof value !== "string" || !value) return null
  return value
}

/**
 * Создаёт новый config с обновлённым devicePresetId, не теряя остальные поля
 * (fingerprint, etc). `null` — удаляет ключ из config (operator выбрал Custom).
 */
export function withDevicePresetId(
  config: unknown,
  devicePresetId: string | null,
): Record<string, unknown> {
  const base = config && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {}
  if (devicePresetId) {
    base.devicePresetId = devicePresetId
  } else {
    delete base.devicePresetId
  }
  return base
}

/**
 * Группирует presets по бренду с сортировкой popular-first → year-desc.
 * Используется для секционирования UI selector'а.
 */
export function groupPresetsByBrand(): Array<{ brand: DevicePreset["brand"]; presets: DevicePreset[] }> {
  const groups = new Map<DevicePreset["brand"], DevicePreset[]>()
  for (const preset of DEVICE_HARDWARE_PRESETS) {
    const list = groups.get(preset.brand) ?? []
    list.push(preset)
    groups.set(preset.brand, list)
  }
  const result: Array<{ brand: DevicePreset["brand"]; presets: DevicePreset[] }> = []
  for (const [brand, presets] of groups) {
    const sorted = [...presets].sort((a, b) => {
      if (a.popular && !b.popular) return -1
      if (!a.popular && b.popular) return 1
      return b.year - a.year
    })
    result.push({ brand, presets: sorted })
  }
  return result
}
