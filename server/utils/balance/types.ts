/**
 * Типы балансной системы. Универсальный формат для всех сервисов.
 * Поддерживает 3 формата представления: balance (валюта), quota (объём), expiry (срок).
 */

export type BalanceStatus = "ok" | "low" | "critical" | "unknown" | "error"

/**
 * Откуда получены данные balance:
 * - api: ответ публичного API сервиса
 * - manual: запись в ServiceBalanceEntry (operator ввёл вручную)
 * - estimate: расчётно (baseline - accumulated cost из AiAuditLog)
 * - fallback: API не отвечает или нет credentials, читаем последнюю manual запись
 */
export type BalanceSource = "api" | "manual" | "estimate" | "fallback"

export interface BalanceAmount {
  currency: string
  amount: number
}

export interface BalanceQuota {
  used: number
  limit: number
  unit: string
}

export interface BalanceExpiry {
  daysRemaining: number
  expiresAt: string
}

export interface ServiceBalance {
  service: string
  status: BalanceStatus
  /** Канал получения данных. Опционально для backward compat. */
  source?: BalanceSource

  balance?: BalanceAmount
  quota?: BalanceQuota
  expiry?: BalanceExpiry

  lowThreshold?: number
  criticalThreshold?: number

  checkedAt: string
  durationMs: number
  /** Заполняется когда balance введён вручную / получен из API — указывает на возраст данных */
  enteredAt?: string
  /** Кто ввёл (для admin диагностики) */
  enteredByUserId?: number | null
  /** Произвольные заметки от admin'а */
  notes?: string | null
  /** Структурные данные провайдера: usage, plan, expiry и т.п. */
  metadata?: Record<string, unknown> & {
    /** balance_v2: средний расход за окно (обогащается aggregator'ом после fetchAllBalances) */
    burnRate?: {
      dailyAvgUsd: number
      windowDays: number
      projectedZeroDate?: string
    }
  }
  error?: string
}

export interface BalanceProvider {
  readonly service: string
  fetchBalance(): Promise<ServiceBalance>
}
