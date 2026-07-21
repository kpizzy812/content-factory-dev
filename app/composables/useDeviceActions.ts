import type {
  DeviceProfileCreateInput,
  DeviceProfileDto,
  DeviceProfileUpdateInput,
  DeviceStartProfileResponse,
  DeviceSyncResult,
  DeviceTestPushResult,
} from "~~/shared/types/device-profile"

/**
 * useDeviceActions — методы CRUD/start/stop/sync для device-профилей.
 *
 * R6 (миграция DuoPlus): браузерная функциональность (cookies/fingerprint/
 * client-side launcher/credentials/diagnose/hygiene/cleanup) удалена. Соответствующие
 * серверные эндпоинты заглушены 501 (start/stop/test/resync) или удалены (admin).
 * Реализация под нового провайдера — Этап 3.
 */
export function useDeviceActions() {
  const isBusy = ref(false)
  const error = ref<string | null>(null)
  // Структурированный детал последней ошибки (start/stop/resync/test). UI откроет
  // диагностическую модалку с phase/providerStatus/providerBody.
  const lastActionError = ref<DeviceTestPushResult | null>(null)

  function extractError(e: unknown): string {
    return (
      (e as { data?: { message?: string } })?.data?.message
      ?? (e instanceof Error ? e.message : "Неизвестная ошибка")
    )
  }

  /**
   * Извлекает structured detail из server-side createError. Возвращает
   * DeviceTestPushResult-совместимый объект для переиспользования модалки
   * DeviceTestResultModal.
   */
  function buildActionError(
    e: unknown,
    method: DeviceTestPushResult["method"],
  ): DeviceTestPushResult {
    const errObj = e as {
      message?: string
      statusCode?: number
      data?: {
        phase?: string
        indigoStatus?: number
        indigoBody?: unknown
        url?: string
        method?: string
      }
    }
    const data = errObj.data ?? {}
    return {
      ok: false,
      status: data.indigoStatus ?? errObj.statusCode ?? 0,
      method,
      url: data.url ?? "",
      requestBody: {},
      responseBody: data.indigoBody ?? null,
      error: errObj.message ?? extractError(e),
      phase: data.phase,
    }
  }

  async function createProfile(
    input: DeviceProfileCreateInput,
  ): Promise<DeviceProfileDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeviceProfileDto }>("/api/device-profiles", {
        method: "POST",
        body: input,
      })
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function updateProfile(
    id: string,
    input: DeviceProfileUpdateInput,
  ): Promise<DeviceProfileDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeviceProfileDto }>(
        `/api/device-profiles/${id}`,
        { method: "PUT", body: input },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function deleteProfile(id: string): Promise<boolean> {
    isBusy.value = true
    error.value = null
    try {
      await $fetch(`/api/device-profiles/${id}`, { method: "DELETE" })
      return true
    } catch (e: unknown) {
      error.value = extractError(e)
      return false
    } finally {
      isBusy.value = false
    }
  }

  // Server-side structured error shape (start.post.ts / stop.post.ts) — endpoint
  // всегда возвращает 200 (избегаем Cloudflare 5xx интерсепта), body содержит
  // либо data либо error. Если error !== null → action failed.
  interface ServerActionError {
    statusCode: number
    message: string
    phase: string
    indigoStatus: number
    indigoBody: unknown
    url: string
    method: string
    errorClass?: string
    stackHead?: string
  }

  function actionErrorToTestResult(
    err: ServerActionError,
    method: DeviceTestPushResult["method"],
  ): DeviceTestPushResult {
    return {
      ok: false,
      status: err.indigoStatus ?? err.statusCode ?? 0,
      method,
      url: err.url ?? "",
      requestBody: {},
      responseBody: err.indigoBody ?? null,
      error: err.message ?? "Unknown error",
      phase: err.phase,
    }
  }

  async function startProfile(
    id: string,
    automation = false,
  ): Promise<DeviceStartProfileResponse | null> {
    isBusy.value = true
    error.value = null
    lastActionError.value = null
    try {
      const res = await $fetch<{
        data: DeviceStartProfileResponse | null
        error: ServerActionError | null
      }>(`/api/device-profiles/${id}/start`, { method: "POST", body: { automation } })
      if (res.error) {
        error.value = res.error.message
        lastActionError.value = actionErrorToTestResult(res.error, "start")
        return null
      }
      return res.data
    } catch (e: unknown) {
      // Network failure / 4xx auth / etc — старый путь
      error.value = extractError(e)
      lastActionError.value = buildActionError(e, "start")
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function stopProfile(id: string): Promise<boolean> {
    isBusy.value = true
    error.value = null
    lastActionError.value = null
    try {
      const res = await $fetch<{
        data: { stopped: boolean } | null
        error: ServerActionError | null
      }>(`/api/device-profiles/${id}/stop`, { method: "POST" })
      if (res.error) {
        error.value = res.error.message
        lastActionError.value = actionErrorToTestResult(res.error, "stop")
        return false
      }
      return true
    } catch (e: unknown) {
      error.value = extractError(e)
      lastActionError.value = buildActionError(e, "stop")
      return false
    } finally {
      isBusy.value = false
    }
  }

  /**
   * @deprecated после M.1 multi-account — используй addAccount.
   * Оставлен как wrapper над link-account.post.ts для backwards compat с
   * AccountDeviceTab и старыми вызовами. Реализует 1:1 поведение.
   */
  async function linkAccount(
    id: string,
    socialAccountId: number,
  ): Promise<DeviceProfileDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeviceProfileDto }>(
        `/api/device-profiles/${id}/link-account`,
        { method: "POST", body: { socialAccountId } },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  /**
   * Добавляет account в DeviceProfile.accounts (multi-account M.2).
   * Возвращает обновлённый DTO. На US-proxy guard fail (412) — null, error.value
   * содержит сообщение от сервера. UI badge принимает решение по proxyCountryGuard
   * до клика.
   */
  async function addAccount(
    profileId: string,
    socialAccountId: number,
    options?: { isPrimary?: boolean },
  ): Promise<DeviceProfileDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeviceProfileDto }>(
        `/api/device-profiles/${profileId}/accounts`,
        {
          method: "POST",
          body: {
            socialAccountId,
            isPrimary: options?.isPrimary ?? false,
          },
        },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function removeAccount(
    profileId: string,
    socialAccountId: number,
  ): Promise<DeviceProfileDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeviceProfileDto }>(
        `/api/device-profiles/${profileId}/accounts/${socialAccountId}`,
        { method: "DELETE" },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function setPrimaryAccount(
    profileId: string,
    socialAccountId: number,
  ): Promise<DeviceProfileDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeviceProfileDto }>(
        `/api/device-profiles/${profileId}/accounts/${socialAccountId}/primary`,
        { method: "PUT" },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function unlinkAccount(id: string): Promise<DeviceProfileDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeviceProfileDto }>(
        `/api/device-profiles/${id}/unlink-account`,
        { method: "POST" },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  /**
   * Dry-run push в облако. Возвращает полный response (status, тело) для дебага,
   * НЕ меняет syncStatus в БД. Полезно проверить пройдёт ли push с текущим payload.
   */
  async function testProfilePush(id: string): Promise<DeviceTestPushResult | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<DeviceTestPushResult>(
        `/api/device-profiles/${id}/test`,
        { method: "POST" },
      )
      return res
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  async function resyncProfile(id: string): Promise<DeviceProfileDto | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeviceProfileDto }>(
        `/api/device-profiles/${id}/resync`,
        { method: "POST" },
      )
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  // === Sync state с реальным runtime устройства ===
  //
  // Reconciliation БД ↔ провайдер. Catches external start/stop. Probe info
  // endpoint, обновляет БД через server-side sync-state endpoint. Если провайдер
  // не поддерживает info endpoint → syncedTo='unsupported', UI просто оставляет
  // БД state как есть.

  interface SyncStateData {
    syncedTo: "running" | "stopped" | "unsupported"
    port: number | null
    attempts: Array<{ method: string; url: string; status: number; ok: boolean; error?: string }>
  }

  async function syncProfileState(id: string): Promise<SyncStateData | null> {
    error.value = null
    try {
      const res = await $fetch<{
        data: SyncStateData | null
        error: ServerActionError | null
      }>(`/api/device-profiles/${id}/sync-state`, { method: "POST" })
      if (res.error) {
        error.value = res.error.message
        return null
      }
      return res.data
    } catch (e: unknown) {
      // Network/4xx/5xx из обёртки — silent (это background sync, не должен
      // ломать UI). Просто записываем в error для возможного debug overlay.
      error.value = extractError(e)
      return null
    }
  }

  async function syncFromRemote(): Promise<DeviceSyncResult | null> {
    isBusy.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: DeviceSyncResult }>("/api/device-profiles/sync", {
        method: "POST",
      })
      return res.data
    } catch (e: unknown) {
      error.value = extractError(e)
      return null
    } finally {
      isBusy.value = false
    }
  }

  return {
    isBusy,
    error,
    lastActionError,
    createProfile,
    updateProfile,
    deleteProfile,
    startProfile,
    stopProfile,
    linkAccount,
    unlinkAccount,
    addAccount,
    removeAccount,
    setPrimaryAccount,
    resyncProfile,
    testProfilePush,
    syncFromRemote,
    syncProfileState,
  }
}
