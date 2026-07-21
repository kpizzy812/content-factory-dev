/**
 * Типы для дашборда здоровья аккаунтов (/admin/accounts-health).
 * DTO специально не содержит секретов: вместо loginEmail/loginPassword/twoFASecret
 * — boolean-флаги hasLoginCredentials и has2FA.
 */

export type AccountsHealthPlatform = "tiktok" | "instagram" | "youtube"
export type AccountsHealthAccountStatus = "active" | "expired" | "revoked"
export type AccountsHealthWarmupStatus = "new" | "warming" | "ready" | "cold"
export type AccountsHealthProxyStatus =
  | "healthy"
  | "degraded"
  | "dead"
  | "unverified"
  | "expired"

export interface AccountHealthRow {
  id: number
  displayName: string
  platform: AccountsHealthPlatform
  status: AccountsHealthAccountStatus
  app: { id: number; name: string } | null
  hasLoginCredentials: boolean
  has2FA: boolean
  hasProxy: boolean
  proxyId: string | null
  proxyStatus: AccountsHealthProxyStatus | null
  proxyLabel: string | null
  hasDeviceProfile: boolean
  warmupStatus: AccountsHealthWarmupStatus
  lastWarmupAt: string | null
  lastPostedAt: string | null
  totalPostsPublished: number
  completenessPercent: number
}

export interface AccountsHealthSummary {
  total: number
  activeCount: number
  expiredCount: number
  revokedCount: number
  withoutCredentials: number
  withoutProxy: number
  withDeadProxy: number
  withDegradedProxy: number
  withoutWarmup7d: number
  coldAccounts: number
  without2FA: number
}

export interface AccountsHealthByPlatform {
  tiktok: number
  youtube: number
  instagram: number
}

export interface AccountsHealthResponse {
  data: {
    summary: AccountsHealthSummary
    byPlatform: AccountsHealthByPlatform
    accounts: AccountHealthRow[]
  }
}
