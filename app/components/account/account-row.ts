/**
 * Строка списка аккаунтов ровно в том виде, в каком её отдаёт `GET /api/accounts`.
 *
 * Отдельный тип, потому что его читают и таблица, и панель деталей, и страница:
 * без него каждая из трёх описывала бы форму по-своему и они бы разъехались.
 */
export interface AccountRow {
  id: number
  appId: number
  platform: string
  displayName: string
  platformUserId: string | null
  status: string
  expiresAt: string | null
  lastPostedAt: string | null
  createdAt: string
  updatedAt: string
  postingMethod?: string | null
  loginCheckedAt?: string | null
  loginCheckedStatus?: boolean | null
  loginCheckedUsername?: string | null
  proxyId?: string | null
  deviceProfileId?: string | null
  proxy?: { id: string, label: string, status: string } | null
  _count?: { uploads: number, groups: number }
  app?: { id: number, name: string } | null
  styleProfile?: { id: number, status: string, version: number } | null
  profileCompleteness?: number
  hasLoginCredentials?: boolean
}
