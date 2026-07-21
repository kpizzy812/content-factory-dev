/**
 * Lazy enrichment template variables балансовыми значениями.
 *
 * Зовётся из sendTemplateAlert до renderTemplate. Если шаблон не использует
 * ни одну из balance-переменных — fetchAllBalances не зовётся (нулевые издержки).
 *
 * Список ключей синхронизирован с VARIABLE_REGISTRY (scope=system, availability=guaranteed).
 */

import { fetchAllBalances } from "./aggregator"
import { formatBalancesCompact, formatBurnRates, formatLowServices, formatTotalUsd } from "./formatter"

const BALANCE_KEYS = ["balance", "balance_low_services", "balance_total_usd", "balance_burn_rate"] as const

function messageReferencesBalance(messageBody: string): boolean {
  for (const key of BALANCE_KEYS) {
    if (messageBody.includes(`{{${key}}}`)) return true
  }
  return false
}

export async function enrichVariablesWithBalance(
  messageBody: string,
  existing: Record<string, string>,
): Promise<Record<string, string>> {
  if (!messageReferencesBalance(messageBody)) return existing

  const balances = await fetchAllBalances()

  return {
    ...existing,
    balance: existing.balance ?? formatBalancesCompact(balances),
    balance_low_services: existing.balance_low_services ?? formatLowServices(balances),
    balance_total_usd: existing.balance_total_usd ?? formatTotalUsd(balances),
    balance_burn_rate: existing.balance_burn_rate ?? formatBurnRates(balances),
  }
}
