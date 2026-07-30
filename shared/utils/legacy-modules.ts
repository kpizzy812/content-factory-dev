/**
 * Карта унаследованных от VideoCamp зон, которые не входят в согласованный
 * контур ContentFactory. Все зоны выключены по умолчанию и включаются только
 * явным env-флагом со значением ровно "true".
 *
 * Код зон намеренно не удаляется: docs/superpowers/specs/2026-07-22-content-factory-design.md
 * §13 шаг 10 разрешает удаление только после подтверждённой официальной замены.
 */

export const LEGACY_MODULE_IDS = [
  "deviceAutomation",
  "proxyPool",
  "googleDrive",
  "marketingCampSync",
] as const

export type LegacyModuleId = typeof LEGACY_MODULE_IDS[number]
export type LegacyModuleMap = Record<LegacyModuleId, boolean>

const ENV_FLAGS: Record<LegacyModuleId, string> = {
  deviceAutomation: "LEGACY_DEVICE_AUTOMATION_ENABLED",
  proxyPool: "LEGACY_PROXY_POOL_ENABLED",
  googleDrive: "LEGACY_GOOGLE_DRIVE_ENABLED",
  marketingCampSync: "LEGACY_MARKETING_CAMP_SYNC_ENABLED",
}

/** Префиксы API, принадлежащие каждой зоне. Совпадение строгое: по сегментам пути. */
const PATH_PREFIXES: Record<LegacyModuleId, string[]> = {
  deviceAutomation: ["/api/device-profiles", "/api/posting-jobs", "/api/posting", "/api/warmup"],
  proxyPool: ["/api/proxies"],
  googleDrive: ["/api/google-drive"],
  marketingCampSync: ["/api/ideas/sync"],
}

export function readLegacyModules(env: Record<string, string | undefined>): LegacyModuleMap {
  const map = {} as LegacyModuleMap
  for (const id of LEGACY_MODULE_IDS) {
    map[id] = env[ENV_FLAGS[id]] === "true"
  }
  return map
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export function isLegacyPathBlocked(path: string, modules: LegacyModuleMap): boolean {
  const clean = path.split("?")[0]!
  for (const id of LEGACY_MODULE_IDS) {
    if (modules[id]) continue
    if (PATH_PREFIXES[id].some(prefix => matchesPrefix(clean, prefix))) return true
  }
  return false
}
