/**
 * DeviceProfile → DTO маппер для API responses.
 * Не выдаёт config (Json snapshot), не выдаёт cookiesSnapshot (encrypted).
 *
 * Канонический `toDeviceProfileDto` возвращает чистый нейтральный
 * `DeviceProfileDto` без Indigo-специфичных полей. Indigo-совместимый алиас
 * `toIndigoProfileDto` снесён в R7.
 *
 * Цикл M (multi-account): поля accounts[] (linked SocialAccounts через
 * DeviceProfileAccount) и proxyCountryGuard (server-side computed). Caller должен
 * передавать profile с include: { accounts: { include: { socialAccount: { include: { app } } } } }
 * + include: { proxy: { select: { ...expectedCountry } } }.
 */

import type {
  DeviceProfile,
  DeviceProfileAccount,
  Proxy,
  SocialAccount,
  App,
} from "../../../app/generated/prisma/client"
import type {
  DeviceDuoplusInfo,
  DevicePlatformType,
  DeviceProfileDto,
  DeviceProfileLinkedAccountDto,
  DeviceSessionState,
} from "../../../shared/types/device-profile"
import { computeUsProxyGuard } from "./us-proxy-guard"

/**
 * Достаёт last-known DuoPlus-снапшот из DeviceProfile.config.duoplus
 * (наполняется device-sync P7). null если профиль ещё не синкался.
 */
function extractDuoplusInfo(config: unknown): DeviceDuoplusInfo | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null
  const duoplus = (config as Record<string, unknown>).duoplus
  if (!duoplus || typeof duoplus !== "object" || Array.isArray(duoplus)) return null
  const snap = duoplus as Record<string, unknown>
  const deviceStatus = typeof snap.deviceStatus === "number" ? snap.deviceStatus : null
  const area = typeof snap.area === "string" && snap.area ? snap.area : null
  const adb = typeof snap.adb === "string" && snap.adb.trim() ? snap.adb.trim() : null
  const size = typeof snap.size === "string" && snap.size ? snap.size : null
  return { deviceStatus, area, adbAddress: adb, size }
}

type LinkedAccountRow = DeviceProfileAccount & {
  socialAccount: SocialAccount & { app?: Pick<App, "id" | "name"> | null }
}

type RowWithRelations = DeviceProfile & {
  socialAccount?: (SocialAccount & { app?: Pick<App, "id" | "name"> | null }) | null
  proxy?: Pick<Proxy, "id" | "label" | "status" | "type" | "expectedCountry"> | null
  accounts?: LinkedAccountRow[]
}

function computeSessionState(row: DeviceProfile): DeviceSessionState {
  // Port есть → точно running (automation mode возвращает CDP port).
  if (row.lastSessionPort) return "running"
  // Port нет, но profile был started без последующего end → standalone browser
  // running (real Indigo X non-automation case: возвращает success без port).
  // EndedAt null или EndedAt < StartedAt → последняя операция была старт.
  if (
    row.lastSessionStartedAt
    && (!row.lastSessionEndedAt || row.lastSessionEndedAt < row.lastSessionStartedAt)
  ) {
    return "running"
  }
  return "idle"
}

function mapLinkedAccount(row: LinkedAccountRow): DeviceProfileLinkedAccountDto {
  return {
    id: row.socialAccount.id,
    displayName: row.socialAccount.displayName,
    platform: row.socialAccount.platform,
    appName: row.socialAccount.app?.name,
    appId: row.socialAccount.appId,
    status: row.socialAccount.status,
    isPrimary: row.isPrimary,
    addedAt: row.addedAt.toISOString(),
    warmupStatus: row.socialAccount.warmupStatus,
  }
}

/**
 * Нейтральный канонический маппер — возвращает device-DTO без Indigo-специфики.
 */
export function toDeviceProfileDto(row: RowWithRelations): DeviceProfileDto {
  // Sort accounts: primary first, потом по addedAt asc.
  const sortedAccounts: LinkedAccountRow[] = (row.accounts ?? [])
    .slice()
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
      return a.addedAt.getTime() - b.addedAt.getTime()
    })

  return {
    id: row.id,
    indigoId: row.indigoId,
    indigoFolderId: row.indigoFolderId,
    socialAccountId: row.socialAccountId,
    proxyId: row.proxyId,
    name: row.name,
    platformType: row.platformType as DevicePlatformType,
    os: row.os,
    userAgent: row.userAgent,
    screenResolution: row.screenResolution,
    language: row.language,
    timezone: row.timezone,
    syncStatus: row.syncStatus,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: row.lastSyncError,
    totalSessions: row.totalSessions,
    lastSessionStartedAt: row.lastSessionStartedAt?.toISOString() ?? null,
    lastSessionEndedAt: row.lastSessionEndedAt?.toISOString() ?? null,
    lastSessionPort: row.lastSessionPort,
    notes: row.notes,
    tags: row.tags ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    socialAccount: row.socialAccount
      ? {
          id: row.socialAccount.id,
          displayName: row.socialAccount.displayName,
          platform: row.socialAccount.platform,
          appName: row.socialAccount.app?.name,
        }
      : null,
    proxy: row.proxy
      ? {
          id: row.proxy.id,
          label: row.proxy.label,
          status: row.proxy.status,
          type: row.proxy.type,
          expectedCountry: row.proxy.expectedCountry ?? null,
        }
      : null,
    accounts: sortedAccounts.map(mapLinkedAccount),
    proxyCountryGuard: computeUsProxyGuard(
      row.proxy ? { id: row.proxy.id, expectedCountry: row.proxy.expectedCountry } : null,
      row.platformType,
    ),
    sessionState: computeSessionState(row),
    duoplus: extractDuoplusInfo(row.config),
  }
}
