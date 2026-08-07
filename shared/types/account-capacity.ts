/**
 * Свободная ёмкость публикаций и прогноз восстановления лимита.
 *
 * Два разных источника в одном ответе. Ёмкость — замер площадки, который мы
 * сохраняем в момент отправки; прогноз — наша собственная история публикаций.
 * Смешивать их нельзя, поэтому они и лежат порознь.
 */

export interface AccountCapacityRow {
  id: number
  displayName: string
  platform: string
  quotaUsage: number | null
  quotaTotal: number | null
  quotaCheckedAt: string | null
  /** Замеру больше суток — показывать его как текущий нельзя. */
  quotaStale: boolean
  publishedLast24h: number
  /** Свободные слоты по свежему замеру; null — «не знаем», а не «ноль». */
  free: number | null
}

export interface CapacityRecoveryPoint {
  /** Начало часа, ISO. */
  hour: string
  recovered: number
}

export interface PublishingCapacity {
  accounts: AccountCapacityRow[]
  /** Сумма свободных слотов у аккаунтов со свежим замером; null — таких нет. */
  totalFree: number | null
  accountsWithoutLimit: number
  recovery: CapacityRecoveryPoint[]
  fullyRecoveredAt: string | null
}
