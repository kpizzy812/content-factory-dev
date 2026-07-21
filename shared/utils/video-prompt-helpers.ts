/**
 * Хелперы для сборки video/image prompt'ов.
 * DEVICE_NEGATIVES + buildDeviceOrientationBlock защищают от регулярного бага
 * Kling/FLUX, когда экран рендерится на задней крышке устройства или развёрнут
 * от зрителя. Используется в story-architect/scene-planner/continuity-director
 * системных промптах И в runtime-склейке negative_prompt для Kling и FLUX.
 */

/** Допустимые типы устройств в кадре. */
export const DEVICE_TYPES = [
  'phone',
  'tablet',
  'laptop',
  'desktop_monitor',
  'tv',
  'smartwatch',
] as const

export type DeviceType = (typeof DEVICE_TYPES)[number]

/**
 * Жёсткий список негативов для Kling/FLUX, когда сцена содержит устройство.
 * EN-only, без двойного отрицания (см. sanitizeNegativeConstraints).
 * Источник бага: модели любят рисовать UI на back cover телефона/монитора.
 */
export const DEVICE_NEGATIVES: readonly string[] = [
  'screen on the back of the phone',
  'display facing away from camera',
  'phone held with back to viewer while character looks at screen',
  'monitor backside facing camera with content showing through',
  'screen visible through device casing',
  'back cover with display',
  'rear of phone showing UI',
  'wrong-facing screen',
  'screen orientation flipped',
  'display behind the device',
]

/**
 * Доп-инструкция для image-to-video с image-prior: Kling может ротейтить
 * пришедший скриншот, особенно если в prompt описано действие героя с экраном.
 */
export const APP_SCREEN_ANCHOR_NEGATIVE = 'do not rotate, mirror, or flip the input image content'

/**
 * Очистка / нормализация массива devicesInScene из ответа AI.
 * Возвращает уникальный список валидных DeviceType.
 */
export function sanitizeDevicesInScene(input: unknown): DeviceType[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<DeviceType>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const value = raw.trim().toLowerCase()
    if ((DEVICE_TYPES as readonly string[]).includes(value)) {
      seen.add(value as DeviceType)
    }
  }
  return Array.from(seen)
}

/**
 * Блок инструкций для positive prompt (Kling/FLUX).
 * Возвращает пустую строку если устройств нет — caller просто конкатит результат.
 */
export function buildDeviceOrientationBlock(devices: DeviceType[] | null | undefined): string {
  if (!devices || devices.length === 0) return ''
  return `
[DEVICE ORIENTATION RULES — CRITICAL]
The scene contains: ${devices.join(', ')}.
- The display/screen MUST face the camera and the protagonist simultaneously
- The character holds the device with the screen TOWARD their face
- Camera frames the device from the front (over-shoulder or face-cam style)
- Show the screen content clearly and legibly — UI elements visible on the front
- Phone/tablet body shows the front bezel, NOT the back cover
- Monitor/TV: front of the display is visible, with content on it
- Backs of devices (camera bumps, logos, ports) must NEVER show display content
`
}

/**
 * Возвращает массив негативов для сцены: общий DEVICE_NEGATIVES если есть устройства
 * + APP_SCREEN_ANCHOR_NEGATIVE если есть привязка к скриншоту приложения.
 */
export function buildDeviceNegativesForScene(opts: {
  devices?: DeviceType[] | null
  hasAppScreenRef?: boolean
}): string[] {
  const out: string[] = []
  if (opts.devices && opts.devices.length > 0) {
    out.push(...DEVICE_NEGATIVES)
  }
  if (opts.hasAppScreenRef) {
    out.push(APP_SCREEN_ANCHOR_NEGATIVE)
  }
  return out
}

/**
 * Краткая текстовая нотка для системных промптов агентов (story-architect,
 * scene-planner, continuity-director). Объясняет AI как формулировать
 * device-related forbidden elements и что device-rules уже инжектируются
 * downstream — дублировать их в forbiddenElements/negativeConstraints не нужно.
 */
export const DEVICE_RULES_NOTE_FOR_AGENTS = `
[DEVICE & SCREEN RULES — для negativeConstraints / forbiddenElements]
Когда упоминаешь устройства (phone/tablet/laptop/monitor/tv/smartwatch):
- ВСЕГДА на английском
- POSITIVE forbidden phrases (НЕ "missing" / "no" / "without")
  Хорошо: "screen on rear of phone", "display facing wrong direction", "monitor backside with content"
  Плохо:  "no screen on back" (инвертируется в Kling), "missing front display"
- Базовые device-orientation негативы (screen on the back, wrong-facing screen и т.п.)
  АВТОМАТИЧЕСКИ инжектируются downstream — НЕ дублируй их.
  Фокусируй forbiddenElements на сцен-специфичных вещах: фон, освещение, реквизит.
`
