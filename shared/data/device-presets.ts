/**
 * Device profile presets — фиксированные таблицы для выпадающих списков формы.
 *
 * Используются:
 * - `DeviceProfileEditModal.vue` — заполняет dropdowns OS / Resolution / Language / Timezone.
 * - smart watchers — переключение platformType подтягивает defaults через DEVICE_DEFAULTS_BY_PLATFORM.
 *
 * Все таблицы read-only (`as const`). Изменение требует review + smoke test.
 *
 * Scope timezone — только Европа и США в этой итерации (см. ТЗ).
 */

import type { DevicePlatformType } from "~~/shared/types/device-profile"

// =====================================================================
// PLATFORM × OS
// =====================================================================

export interface DeviceOsOption {
  value: string
  label: string
}

export const DEVICE_OS_BY_PLATFORM: Record<DevicePlatformType, readonly DeviceOsOption[]> = {
  desktop: [
    { value: "Windows 11", label: "Windows 11" },
    { value: "Windows 10", label: "Windows 10" },
    { value: "macOS 14", label: "macOS 14 (Sonoma)" },
    { value: "macOS 13", label: "macOS 13 (Ventura)" },
    { value: "macOS 12", label: "macOS 12 (Monterey)" },
    { value: "Linux", label: "Linux" },
  ],
  mobile_android: [
    { value: "Android 14", label: "Android 14" },
    { value: "Android 13", label: "Android 13" },
    { value: "Android 12", label: "Android 12" },
    { value: "Android 11", label: "Android 11" },
  ],
  mobile_ios: [
    { value: "iOS 18", label: "iOS 18" },
    { value: "iOS 17", label: "iOS 17" },
    { value: "iOS 16", label: "iOS 16" },
    { value: "iOS 15", label: "iOS 15" },
  ],
} as const

// =====================================================================
// PLATFORM × SCREEN RESOLUTION
// =====================================================================

export interface DeviceResolutionOption {
  value: string
  label: string
}

export const DEVICE_RESOLUTIONS_BY_PLATFORM: Record<DevicePlatformType, readonly DeviceResolutionOption[]> = {
  desktop: [
    { value: "1920x1080", label: "1920×1080 (Full HD)" },
    { value: "2560x1440", label: "2560×1440 (QHD)" },
    { value: "3840x2160", label: "3840×2160 (4K UHD)" },
    { value: "1680x1050", label: "1680×1050" },
    { value: "1600x900", label: "1600×900" },
    { value: "1512x982", label: "1512×982 (MacBook Pro 14)" },
    { value: "1470x956", label: "1470×956 (MacBook Air M2 13)" },
    { value: "1440x900", label: "1440×900" },
    { value: "1366x768", label: "1366×768" },
    { value: "1280x720", label: "1280×720 (HD)" },
  ],
  mobile_android: [
    { value: "412x915", label: "412×915 (Pixel 7/8/9 Pro)" },
    { value: "448x998", label: "448×998 (Pixel 8 Pro)" },
    { value: "393x851", label: "393×851 (Pixel 5)" },
    { value: "384x824", label: "384×824 (Galaxy S24 Ultra)" },
    { value: "384x854", label: "384×854 (Generic)" },
    { value: "360x800", label: "360×800 (Galaxy S20)" },
    { value: "360x780", label: "360×780 (Galaxy S22/S23/S24)" },
    { value: "412x914", label: "412×914 (OnePlus)" },
  ],
  mobile_ios: [
    { value: "390x844", label: "390×844 (iPhone 13/14)" },
    { value: "393x852", label: "393×852 (iPhone 15)" },
    { value: "402x874", label: "402×874 (iPhone 16 Pro)" },
    { value: "375x812", label: "375×812 (iPhone X/11 Pro)" },
    { value: "414x896", label: "414×896 (iPhone 11/XR)" },
    { value: "428x926", label: "428×926 (iPhone 13 Pro Max)" },
  ],
} as const

// =====================================================================
// LANGUAGES (BCP 47)
// =====================================================================

export interface DeviceLanguageOption {
  value: string
  label: string
}

export const DEVICE_LANGUAGES: readonly DeviceLanguageOption[] = [
  { value: "en-US", label: "English (US) — en-US" },
  { value: "en-GB", label: "English (UK) — en-GB" },
  { value: "ru-RU", label: "Русский — ru-RU" },
  { value: "de-DE", label: "Deutsch — de-DE" },
  { value: "fr-FR", label: "Français — fr-FR" },
  { value: "es-ES", label: "Español (España) — es-ES" },
  { value: "it-IT", label: "Italiano — it-IT" },
  { value: "pt-PT", label: "Português (PT) — pt-PT" },
  { value: "pt-BR", label: "Português (BR) — pt-BR" },
  { value: "pl-PL", label: "Polski — pl-PL" },
  { value: "nl-NL", label: "Nederlands — nl-NL" },
  { value: "tr-TR", label: "Türkçe — tr-TR" },
  { value: "uk-UA", label: "Українська — uk-UA" },
  { value: "cs-CZ", label: "Čeština — cs-CZ" },
  { value: "hu-HU", label: "Magyar — hu-HU" },
  { value: "el-GR", label: "Ελληνικά — el-GR" },
  { value: "sv-SE", label: "Svenska — sv-SE" },
  { value: "fi-FI", label: "Suomi — fi-FI" },
] as const

// =====================================================================
// TIMEZONES — Europe + United States only (текущая итерация)
// =====================================================================

export type DeviceTimezoneGroup = "Европа" | "США"

export interface DeviceTimezoneOption {
  value: string
  label: string
  group: DeviceTimezoneGroup
}

export const DEVICE_TIMEZONES: readonly DeviceTimezoneOption[] = [
  // Europe
  { value: "Europe/London", label: "London (GMT)", group: "Европа" },
  { value: "Europe/Dublin", label: "Dublin (GMT)", group: "Европа" },
  { value: "Europe/Lisbon", label: "Lisbon (WET)", group: "Европа" },
  { value: "Europe/Paris", label: "Paris (CET)", group: "Европа" },
  { value: "Europe/Berlin", label: "Berlin (CET)", group: "Европа" },
  { value: "Europe/Madrid", label: "Madrid (CET)", group: "Европа" },
  { value: "Europe/Rome", label: "Rome (CET)", group: "Европа" },
  { value: "Europe/Amsterdam", label: "Amsterdam (CET)", group: "Европа" },
  { value: "Europe/Brussels", label: "Brussels (CET)", group: "Европа" },
  { value: "Europe/Vienna", label: "Vienna (CET)", group: "Европа" },
  { value: "Europe/Stockholm", label: "Stockholm (CET)", group: "Европа" },
  { value: "Europe/Warsaw", label: "Warsaw (CET)", group: "Европа" },
  { value: "Europe/Prague", label: "Prague (CET)", group: "Европа" },
  { value: "Europe/Budapest", label: "Budapest (CET)", group: "Европа" },
  { value: "Europe/Helsinki", label: "Helsinki (EET)", group: "Европа" },
  { value: "Europe/Athens", label: "Athens (EET)", group: "Европа" },
  { value: "Europe/Istanbul", label: "Istanbul (TRT)", group: "Европа" },
  { value: "Europe/Kyiv", label: "Kyiv (EET)", group: "Европа" },
  { value: "Europe/Moscow", label: "Moscow (MSK)", group: "Европа" },
  // United States
  { value: "America/New_York", label: "New York (ET)", group: "США" },
  { value: "America/Detroit", label: "Detroit (ET)", group: "США" },
  { value: "America/Chicago", label: "Chicago (CT)", group: "США" },
  { value: "America/Denver", label: "Denver (MT)", group: "США" },
  { value: "America/Phoenix", label: "Phoenix (MST)", group: "США" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)", group: "США" },
  { value: "America/Anchorage", label: "Anchorage (AKT)", group: "США" },
  { value: "Pacific/Honolulu", label: "Honolulu (HST)", group: "США" },
] as const

// =====================================================================
// FINGERPRINT — Anti-detect modes
// =====================================================================

export const DEVICE_WEBRTC_MODES = [
  { value: "real", label: "Real (открытый WebRTC)" },
  { value: "replace", label: "Replace (подмена)" },
  { value: "disabled", label: "Disabled (отключён)" },
] as const

export const DEVICE_CANVAS_MODES = [
  { value: "real", label: "Real" },
  { value: "noise", label: "Noise (шум)" },
  { value: "off", label: "Off" },
] as const

export const DEVICE_WEBGL_MODES = [
  { value: "real", label: "Real" },
  { value: "noise", label: "Noise (шум)" },
  { value: "off", label: "Off" },
] as const

export const DEVICE_AUDIO_MODES = [
  { value: "real", label: "Real" },
  { value: "noise", label: "Noise (шум)" },
  { value: "off", label: "Off" },
] as const

export const DEVICE_HARDWARE_CONCURRENCY_OPTIONS = [
  { value: 2, label: "2 ядра" },
  { value: 4, label: "4 ядра" },
  { value: 6, label: "6 ядер" },
  { value: 8, label: "8 ядер" },
  { value: 12, label: "12 ядер" },
  { value: 16, label: "16 ядер" },
] as const

export const DEVICE_MEMORY_OPTIONS = [
  { value: 2, label: "2 GB" },
  { value: 3, label: "3 GB" },
  { value: 4, label: "4 GB" },
  { value: 6, label: "6 GB" },
  { value: 8, label: "8 GB" },
  { value: 16, label: "16 GB" },
] as const

// =====================================================================
// PLATFORM DEFAULTS — всё что подтягивается при смене platformType
// =====================================================================

export interface DevicePlatformDefaults {
  os: string
  resolution: string
  userAgent: string
  webrtc: "real" | "replace" | "disabled"
  canvas: "real" | "noise" | "off"
  webgl: "real" | "noise" | "off"
  audio: "real" | "noise" | "off"
  touchEnabled: boolean
  hardwareConcurrency: number
  deviceMemory: number
}

export const DEVICE_DEFAULTS_BY_PLATFORM: Record<DevicePlatformType, DevicePlatformDefaults> = {
  desktop: {
    os: "Windows 11",
    resolution: "1920x1080",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    webrtc: "replace",
    canvas: "noise",
    webgl: "noise",
    audio: "real",
    touchEnabled: false,
    hardwareConcurrency: 8,
    deviceMemory: 8,
  },
  mobile_android: {
    os: "Android 13",
    resolution: "412x915",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    webrtc: "replace",
    canvas: "noise",
    webgl: "noise",
    audio: "real",
    touchEnabled: true,
    hardwareConcurrency: 8,
    deviceMemory: 6,
  },
  mobile_ios: {
    os: "iOS 17",
    resolution: "390x844",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    webrtc: "replace",
    canvas: "noise",
    webgl: "noise",
    audio: "real",
    touchEnabled: true,
    hardwareConcurrency: 6,
    deviceMemory: 4,
  },
} as const

// =====================================================================
// COUNTRY → LANGUAGE / TIMEZONE smart suggestion mappings
// =====================================================================

/**
 * Country ISO-2 → суггестируемый таймзоны.
 * Используется в watcher proxy → form: если у прокси есть expectedCountry,
 * подставляем дефолтную TZ (только если поле ещё пусто).
 */
export const COUNTRY_TO_TIMEZONE: Record<string, string> = {
  // Europe
  GB: "Europe/London",
  UK: "Europe/London",
  IE: "Europe/Dublin",
  PT: "Europe/Lisbon",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  AT: "Europe/Vienna",
  SE: "Europe/Stockholm",
  PL: "Europe/Warsaw",
  CZ: "Europe/Prague",
  HU: "Europe/Budapest",
  FI: "Europe/Helsinki",
  GR: "Europe/Athens",
  TR: "Europe/Istanbul",
  UA: "Europe/Kyiv",
  RU: "Europe/Moscow",
  // US
  US: "America/New_York",
}

/**
 * Country ISO-2 → BCP 47 language.
 */
export const COUNTRY_TO_LANGUAGE: Record<string, string> = {
  // Europe
  GB: "en-GB",
  UK: "en-GB",
  IE: "en-GB",
  PT: "pt-PT",
  FR: "fr-FR",
  DE: "de-DE",
  ES: "es-ES",
  IT: "it-IT",
  NL: "nl-NL",
  BE: "fr-FR",
  AT: "de-DE",
  SE: "sv-SE",
  PL: "pl-PL",
  CZ: "cs-CZ",
  HU: "hu-HU",
  GR: "el-GR",
  FI: "fi-FI",
  TR: "tr-TR",
  UA: "uk-UA",
  RU: "ru-RU",
  // US
  US: "en-US",
}

/**
 * US-конкретный city → timezone mapping. Применяется только когда country === 'US'.
 * Регистронезависимый матч в utility-функции.
 */
export const US_REGION_TO_TIMEZONE: Record<string, string> = {
  // Eastern
  "new york": "America/New_York",
  "new york city": "America/New_York",
  nyc: "America/New_York",
  manhattan: "America/New_York",
  brooklyn: "America/New_York",
  miami: "America/New_York",
  atlanta: "America/New_York",
  boston: "America/New_York",
  washington: "America/New_York",
  philadelphia: "America/New_York",
  charlotte: "America/New_York",
  // Central
  chicago: "America/Chicago",
  dallas: "America/Chicago",
  houston: "America/Chicago",
  austin: "America/Chicago",
  "new orleans": "America/Chicago",
  nashville: "America/Chicago",
  "kansas city": "America/Chicago",
  // Mountain
  denver: "America/Denver",
  "salt lake city": "America/Denver",
  phoenix: "America/Phoenix",
  // Pacific
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  "san diego": "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  portland: "America/Los_Angeles",
  "las vegas": "America/Los_Angeles",
  // Alaska / Hawaii
  anchorage: "America/Anchorage",
  honolulu: "Pacific/Honolulu",
}

/**
 * Возвращает рекомендованную TZ по country (+ опционально city).
 */
export function suggestTimezone(country: string | null | undefined, city?: string | null): string | null {
  if (!country) return null
  const c = country.toUpperCase()
  if (c === "US" && city) {
    const hit = US_REGION_TO_TIMEZONE[city.trim().toLowerCase()]
    if (hit) return hit
  }
  return COUNTRY_TO_TIMEZONE[c] ?? null
}

/**
 * Возвращает рекомендованный BCP-47 язык по country.
 */
export function suggestLanguage(country: string | null | undefined): string | null {
  if (!country) return null
  return COUNTRY_TO_LANGUAGE[country.toUpperCase()] ?? null
}

/**
 * Парсит строку "1920x1080" → { width: 1920, height: 1080 } | null.
 */
export function parseResolution(value: string | null | undefined): { width: number; height: number } | null {
  if (!value) return null
  const m = value.trim().toLowerCase().match(/^(\d+)\s*[x×]\s*(\d+)$/)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

/**
 * Определяет «это desktop-резолюция» (heuristic: min(width, height) >= 768).
 * Используется в sanity-panel: Desktop res на mobile-платформе → warning.
 */
export function isDesktopResolution(res: string | null | undefined): boolean {
  const parsed = parseResolution(res)
  if (!parsed) return false
  return Math.min(parsed.width, parsed.height) >= 768
}

export function isMobileResolution(res: string | null | undefined): boolean {
  const parsed = parseResolution(res)
  if (!parsed) return false
  return Math.min(parsed.width, parsed.height) < 768
}
