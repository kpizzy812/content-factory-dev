import type { AccountsHealthResponse } from "~~/shared/types/accounts-health"

/**
 * Загрузка дашборда здоровья аккаунтов (/admin/accounts-health).
 */
export function useAccountsHealth() {
  return useFetch<AccountsHealthResponse>("/api/admin/accounts-health", {
    key: "admin-accounts-health",
  })
}
