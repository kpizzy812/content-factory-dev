/**
 * Pure helpers, реализующие логику smart watchers в `DeviceProfileEditModal.vue`.
 *
 * Вынесены отдельно от компонента ради testability — watcher с reactive deps
 * сложно тестировать через mount, но логику применения дефолтов можно покрыть
 * простыми function-tests (без Vue runtime).
 *
 * Контракт каждой функции — pure: получает текущее состояние формы + флаги userTouched,
 * возвращает изменения (Partial<FormFields>), не мутирует входные аргументы.
 *
 * Используются:
 *   - `DeviceProfileEditModal.vue` — два watcher'а (platformType / proxyId).
 *   - `tests/unit/device-form-watchers.spec.ts` — unit-тесты.
 */

import type { DevicePlatformType } from "../types/device-profile"
import type { DeviceFingerprintDto } from "../types/device-profile"
import {
  DEVICE_DEFAULTS_BY_PLATFORM,
  suggestLanguage,
  suggestTimezone,
} from "../data/device-presets"

export interface PlatformAffectedFields {
  os: string
  screenResolution: string
  userAgent: string
  fingerprint: DeviceFingerprintDto
}

export interface PlatformUserTouched {
  os: boolean
  screenResolution: boolean
  userAgent: boolean
  fingerprint: boolean
}

/**
 * Рассчитывает изменения после смены `platformType`.
 *
 * Правило перезаписи поля (для os / screenResolution / userAgent):
 *   field empty → overwrite (юзер ничего не вводил)
 *   field === oldDefault → overwrite (юзер не менял default старой платформы)
 *   userTouched[field] === false → overwrite (юзер не трогал руками — формально пустое)
 *
 * Если хоть одно из условий true — берём новый default. Иначе оставляем как есть
 * (юзер явно ввёл свой UA и переключил platform — UA сохраняется).
 *
 * Fingerprint обновляется только если `userTouched.fingerprint === false`. Это
 * консервативнее: fingerprint — структурное поле, не хочется его частично перетирать.
 *
 * @returns объект с обновлёнными полями (можно spread'ить в form.value).
 */
export function applyPlatformDefaults(
  current: PlatformAffectedFields,
  newPlatform: DevicePlatformType,
  oldPlatform: DevicePlatformType | null,
  userTouched: PlatformUserTouched,
): Partial<PlatformAffectedFields> {
  const defaults = DEVICE_DEFAULTS_BY_PLATFORM[newPlatform]
  if (!defaults) return {}

  const oldDefaults = oldPlatform ? DEVICE_DEFAULTS_BY_PLATFORM[oldPlatform] : null
  const changes: Partial<PlatformAffectedFields> = {}

  if (!current.os || current.os === oldDefaults?.os || !userTouched.os) {
    changes.os = defaults.os
  }
  if (
    !current.screenResolution
    || current.screenResolution === oldDefaults?.resolution
    || !userTouched.screenResolution
  ) {
    changes.screenResolution = defaults.resolution
  }
  if (
    !current.userAgent
    || current.userAgent === oldDefaults?.userAgent
    || !userTouched.userAgent
  ) {
    changes.userAgent = defaults.userAgent
  }

  if (!userTouched.fingerprint) {
    changes.fingerprint = {
      webrtc: defaults.webrtc,
      canvas: defaults.canvas,
      webgl: defaults.webgl,
      audio: defaults.audio,
      touchEnabled: defaults.touchEnabled,
      hardwareConcurrency: defaults.hardwareConcurrency,
      deviceMemory: defaults.deviceMemory,
    }
  }

  return changes
}

export interface ProxyAffectedFields {
  language: string
  timezone: string
}

export interface ProxyUserTouched {
  language: boolean
  timezone: boolean
}

export interface ProxyHint {
  expectedCountry: string | null | undefined
  expectedCity?: string | null | undefined
}

/**
 * Рассчитывает изменения после смены `proxyId` — suggest language/timezone из
 * country/city прокси.
 *
 * ВАЖНО: правило перезаписи здесь СТРОЖЕ чем у platform defaults — обновляем поле
 * только если оно ПУСТОЕ И юзер не трогал. Если юзер уже выбрал en-US и поменял
 * прокси на UK — оставляем en-US (язык фиксируется намерением, не страной exit'а).
 *
 * @returns изменения (может быть пустой объект).
 */
export function applyProxyDefaults(
  current: ProxyAffectedFields,
  proxy: ProxyHint | null,
  userTouched: ProxyUserTouched,
): Partial<ProxyAffectedFields> {
  if (!proxy?.expectedCountry) return {}
  const changes: Partial<ProxyAffectedFields> = {}

  if (!current.language && !userTouched.language) {
    const lang = suggestLanguage(proxy.expectedCountry)
    if (lang) changes.language = lang
  }
  if (!current.timezone && !userTouched.timezone) {
    const tz = suggestTimezone(proxy.expectedCountry, proxy.expectedCity)
    if (tz) changes.timezone = tz
  }

  return changes
}
