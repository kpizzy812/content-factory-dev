/**
 * Composables для раздела «Балансы» в админке.
 */

export type BalanceSource = "api" | "manual" | "estimate" | "fallback"

/**
 * Список валют для select в модалке редактирования баланса. Расширяется добавлением
 * кода ISO 4217. USD первый — текущий дефолт для всех сервисов в KNOWN_SERVICES.
 */
export const BALANCE_CURRENCIES = ["USD", "EUR", "RUB"] as const
export type BalanceCurrency = typeof BALANCE_CURRENCIES[number]

/**
 * Сервисы у которых публичный billing API НЕ существует — авто-фетч невозможен
 * по дизайну, не по поломке. Используется для бейджа «Авто недоступно» в
 * /admin/balances вместо обычного «Manual». Это честный сигнал оператору
 * «здесь auto физически невозможен», а не «здесь auto сломался».
 */
export const AUTO_UNAVAILABLE_SERVICES = new Set<string>(["indigo", "mubert"])

/**
 * true если у сервиса нет публичного billing API (manual by design).
 * Anthropic — отдельный случай: для него source='estimate' (baseline - cost из
 * AiAuditLog), это корректная работа, а не «недоступно».
 */
export function isAutoUnavailable(serviceKey: string): boolean {
  return AUTO_UNAVAILABLE_SERVICES.has(serviceKey)
}

export interface AdminServiceBalanceRow {
  key: string
  label: string
  defaultCurrency: string
  lowThreshold: number
  criticalThreshold: number
  dashboardHint?: string
  balance: {
    service: string
    status: "ok" | "low" | "critical" | "unknown" | "error"
    source?: BalanceSource
    balance?: { currency: string; amount: number }
    quota?: { used: number; limit: number; unit: string }
    expiry?: { daysRemaining: number; expiresAt: string }
    error?: string
    enteredAt?: string
    enteredByUserId?: number | null
    notes?: string | null
    metadata?: Record<string, unknown> & {
      burnRate?: {
        dailyAvgUsd: number
        windowDays: number
        projectedZeroDate?: string
      }
    }
    checkedAt: string
    durationMs: number
  } | null
}

export function useAdminBalances() {
  return useFetch<{ data: { services: AdminServiceBalanceRow[] } }>("/api/admin/balances", {
    key: "admin-balances",
  })
}

/** Строка разбивки расхода: группа операций и сумма за окно. */
export interface AdminSpendGroup {
  key: string
  label: string
  amountUsd: number
}

export interface AdminSpendBreakdown {
  since: string
  windowHours: number
  groups: AdminSpendGroup[]
  totalUsd: number
  videoCount: number
  perVideoUsd: number | null
}

/**
 * Расход за окно по типам операций. Отдельный запрос, а не поле балансов:
 * остаток вводят руками, а расход считается по журналу списаний, и обновляются
 * они в разное время.
 */
export function useAdminSpend() {
  return useFetch<{ data: AdminSpendBreakdown }>("/api/admin/spend", {
    key: "admin-spend",
  })
}

export async function updateServiceBalance(
  service: string,
  payload: { amount: number; currency?: string; notes?: string | null },
): Promise<void> {
  await $fetch(`/api/admin/balances/${encodeURIComponent(service)}`, {
    method: "PUT",
    body: payload,
  })
}
