/**
 * Composable для запуска login-check на SocialAccount.
 *
 * Использование:
 *   const { runCheck, status, isBusy, error } = useLoginCheck()
 *   const result = await runCheck(accountId)
 */
import type { LoginCheckResult } from "~~/shared/types/login-check"

export function useLoginCheck() {
  const status = ref<LoginCheckResult | null>(null)
  const isBusy = ref(false)
  const error = ref<string | null>(null)

  async function runCheck(accountId: number): Promise<LoginCheckResult | null> {
    isBusy.value = true
    error.value = null
    try {
      const result = await $fetch<LoginCheckResult>(
        `/api/accounts/${accountId}/check-login`,
        { method: "POST" },
      )
      status.value = result
      return result
    } catch (err: unknown) {
      const e = err as {
        statusCode?: number
        statusMessage?: string
        data?: { message?: string }
        message?: string
      }
      error.value = e?.data?.message ?? e?.statusMessage ?? e?.message ?? "Login-check failed"
      return null
    } finally {
      isBusy.value = false
    }
  }

  return { runCheck, status, isBusy, error }
}
