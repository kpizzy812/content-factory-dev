export type CredentialField =
  | "loginEmail"
  | "loginPassword"
  | "recoveryEmail"
  | "recoveryPhone"
  | "twoFASecret"

export interface AccountCredentialsBody {
  loginEmail?: string | null
  loginPassword?: string | null
  recoveryEmail?: string | null
  recoveryPhone?: string | null
  twoFASecret?: string | null
  notes?: string | null
  birthDate?: string | null
  registrationSource?: string | null
  warmupStatus?: string | null
  postingMethod?: string | null
}

export interface AccountCredentialsMeta {
  id: number
  birthDate: string | null
  registrationSource: string | null
  warmupStatus: string
  // 'api' | 'browser_automation' - метод постинга (см. SocialPostingMethod enum)
  postingMethod: string
  lastWarmupAt: string | null
  totalPostsPublished: number
  lastPostedAt: string | null
  notes: string | null
  hasLoginEmail: boolean
  hasLoginPassword: boolean
  hasRecoveryEmail: boolean
  hasRecoveryPhone: boolean
  hasTwoFASecret: boolean
  hasLoginCredentials: boolean
}

/**
 * useAccountCredentials — управление шифрованными login-полями и привязкой прокси.
 */
export function useAccountCredentials() {
  const isBusy = ref(false)
  const error = ref<string | null>(null)

  function extractError(e: unknown): string {
    return (
      (e as { data?: { message?: string } })?.data?.message
      ?? (e instanceof Error ? e.message : "Неизвестная ошибка")
    )
  }

  async function saveCredentials(
    accountId: number,
    body: AccountCredentialsBody,
  ): Promise<boolean> {
    isBusy.value = true
    error.value = null
    try {
      await $fetch(`/api/accounts/${accountId}/credentials`, {
        method: "PUT",
        body,
      })
      return true
    } catch (e: unknown) {
      error.value = extractError(e)
      return false
    } finally {
      isBusy.value = false
    }
  }

  async function revealField(
    accountId: number,
    field: CredentialField,
    reason: string,
  ): Promise<string | null> {
    error.value = null
    try {
      const res = await $fetch<{ data: { value: string | null } }>(
        `/api/accounts/${accountId}/credentials/reveal`,
        {
          method: "POST",
          body: { field, reason },
        },
      )
      return res.data.value
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    }
  }

  async function setProxy(
    accountId: number,
    proxyId: string | null,
  ): Promise<boolean> {
    isBusy.value = true
    error.value = null
    try {
      await $fetch(`/api/accounts/${accountId}/proxy`, {
        method: "PUT",
        body: { proxyId },
      })
      return true
    } catch (e: unknown) {
      error.value = extractError(e)
      return false
    } finally {
      isBusy.value = false
    }
  }

  async function loadMeta(
    accountId: number,
  ): Promise<AccountCredentialsMeta | null> {
    error.value = null
    try {
      const res = await $fetch<{ data: AccountCredentialsMeta }>(
        `/api/accounts/${accountId}/credentials-meta`,
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    }
  }

  return { isBusy, error, saveCredentials, revealField, setProxy, loadMeta }
}
