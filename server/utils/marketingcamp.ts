import type { McCreativePayload, IdeaExportPayload } from '../../shared/types/idea'

export interface McPermissions {
  canRead: boolean
  canWrite: boolean
  canCreate: boolean
  canDelete: boolean
  canApprove: boolean
  canRunAgent: boolean
  canApplyChanges: boolean
  canAdmin: boolean
}

export interface McAppAssignment {
  appId: number
  appName: string
  accessLevel: string
  accounts: string
  geos: string
  permissions: string
}

export interface McUser {
  id: number
  email: string
  name: string | null
  surname: string | null
  // Старое поле (presetName или null) для совместимости — сейчас не используется в логике,
  // но MC всё равно его возвращает для других потребителей.
  role?: string | null
  roleName?: string | null
  rolePresetName?: string | null
  // Полный RBAC payload — обязателен для современных версий MC. Если permissions отсутствует,
  // ZavodCamp fail-fast в login.post.ts (раньше был fallback на observer что давало ложно
  // низкие права админам с кастомными presetName типа "Полный доступ").
  permissions?: McPermissions
  // Список slugs модулей, к которым у юзера есть UserModuleAccess в MC.
  modules?: string[]
  // Гранулярные назначения приложений с accessLevel/accounts/geos.
  apps?: McAppAssignment[]
}

interface ValidateSuccess {
  valid: true
  user: McUser
}

interface ValidateFailure {
  valid: false
  error: string
}

type ValidateResult = ValidateSuccess | ValidateFailure

export async function validateExternalUser(
  email: string,
  password: string,
): Promise<ValidateResult> {
  const marketingCampUrl = process.env.MARKETING_CAMP_URL || ""
  const interServiceApiKey = process.env.INTER_SERVICE_API_KEY || ""

  if (!marketingCampUrl) {
    return { valid: false, error: "URL родительской платформы не настроен" }
  }

  if (!interServiceApiKey) {
    return { valid: false, error: "API-ключ межсервисного взаимодействия не настроен" }
  }

  const url = `${marketingCampUrl}/api/auth/validate-external`

  try {
    const response = await $fetch<{ valid: boolean; user?: McUser; error?: string }>(url, {
      method: "POST",
      headers: {
        "X-Service-Key": interServiceApiKey,
        "Content-Type": "application/json",
      },
      body: { email, password },
      timeout: 10_000,
    })

    if (response.valid && response.user) {
      return { valid: true, user: response.user }
    }

    return { valid: false, error: response.error || "Неверные учётные данные" }
  } catch (error: unknown) {
    // Разделяем сетевые ошибки и HTTP-ошибки
    if (error && typeof error === "object" && "statusCode" in error) {
      const httpError = error as { statusCode: number; statusMessage?: string; data?: { error?: string } }

      if (httpError.statusCode === 401 || httpError.statusCode === 403) {
        return { valid: false, error: "Неверный email или пароль" }
      }

      if (httpError.statusCode === 404) {
        return { valid: false, error: "Аккаунт не найден на родительской платформе" }
      }

      return {
        valid: false,
        error: httpError.data?.error || `Ошибка родительской платформы (${httpError.statusCode})`,
      }
    }

    // Сетевые ошибки: timeout, ECONNREFUSED и т.д.
    return { valid: false, error: "Родительская платформа недоступна" }
  }
}

interface HealthCheckResult {
  connected: boolean
  error?: string
}

/**
 * Checks connectivity to MarketingCamp by calling its health endpoint.
 * GET {MARKETING_CAMP_URL}/api/zavod/health with Bearer INTER_SERVICE_API_KEY
 * Timeout: 5 seconds
 */
export async function checkMarketingCampHealth(): Promise<HealthCheckResult> {
  const marketingCampUrl = process.env.MARKETING_CAMP_URL || ""
  const interServiceApiKey = process.env.INTER_SERVICE_API_KEY || ""
  const zavodApiKey = process.env.ZAVOD_API_KEY || ""

  if (!marketingCampUrl) {
    return { connected: false, error: "URL родительской платформы не настроен" }
  }

  if (!interServiceApiKey) {
    return { connected: false, error: "API-ключ межсервисного взаимодействия не настроен" }
  }

  const url = `${marketingCampUrl}/api/zavod/health`

  // MarketingCamp /api/zavod/* проверяет ZAVOD_API_KEY (Bearer auth)
  // Это тот же ключ что и наш zavodApiKey
  const bearerKey = zavodApiKey || interServiceApiKey

  try {
    await $fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerKey}`,
      },
      timeout: 5_000,
    })

    return { connected: true }
  } catch (error: unknown) {
    if (error && typeof error === "object" && "statusCode" in error) {
      const httpError = error as { statusCode: number; statusMessage?: string }
      return {
        connected: false,
        error: `HTTP ${httpError.statusCode}: ${httpError.statusMessage || "Unknown error"}`,
      }
    }

    return { connected: false, error: "Родительская платформа недоступна" }
  }
}

// ═══════════════════════════════════════════════════
// Creative Sync — import/export с MarketingCamp
// ═══════════════════════════════════════════════════

function getMcHeaders(): Record<string, string> {
  const bearerKey = process.env.ZAVOD_API_KEY || process.env.INTER_SERVICE_API_KEY || ""
  return {
    Authorization: `Bearer ${bearerKey}`,
    "Content-Type": "application/json",
  }
}

function getMcBaseUrl(): string {
  const marketingCampUrl = process.env.MARKETING_CAMP_URL || ""
  if (!marketingCampUrl) {
    throw new Error("MARKETING_CAMP_URL не настроен")
  }
  return marketingCampUrl
}

type FetchCreativesResult = {
  ok: true
  creatives: McCreativePayload[]
} | {
  ok: false
  error: string
}

/**
 * Получает список креативов из MarketingCamp.
 * GET {MC_URL}/api/zavod/creatives
 */
export async function fetchRemoteCreatives(params?: {
  appId?: number
  limit?: number
  offset?: number
}): Promise<FetchCreativesResult> {
  try {
    const baseUrl = getMcBaseUrl()
    const query = new URLSearchParams()
    if (params?.appId) query.set("appId", String(params.appId))
    if (params?.limit) query.set("limit", String(params.limit))
    if (params?.offset) query.set("offset", String(params.offset))

    const url = `${baseUrl}/api/zavod/creatives${query.toString() ? `?${query}` : ""}`

    const response = await $fetch<{ data: McCreativePayload[] }>(url, {
      method: "GET",
      headers: getMcHeaders(),
      timeout: 15_000,
    })

    return { ok: true, creatives: response.data ?? [] }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Не удалось получить креативы из MarketingCamp"
    return { ok: false, error: message }
  }
}

type PushCreativeResult = {
  ok: true
  remoteId: number
} | {
  ok: false
  error: string
}

/**
 * Отправляет креатив в MarketingCamp.
 * POST {MC_URL}/api/zavod/import — тот же контракт что и для трендов, но с type=creative
 */
export async function pushCreativeToRemote(payload: IdeaExportPayload & { zavodId: number }): Promise<PushCreativeResult> {
  try {
    const baseUrl = getMcBaseUrl()
    const url = `${baseUrl}/api/zavod/import`

    const response = await $fetch<{ data: { id: number } }>(url, {
      method: "POST",
      headers: getMcHeaders(),
      body: {
        type: "creative",
        items: [payload],
      },
      timeout: 15_000,
    })

    return { ok: true, remoteId: response.data.id }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Не удалось отправить креатив в MarketingCamp"
    return { ok: false, error: message }
  }
}

/**
 * Обновляет существующий креатив в MarketingCamp.
 * PUT {MC_URL}/api/zavod/creatives/{remoteId}
 */
export async function updateRemoteCreative(
  remoteId: number,
  payload: Partial<IdeaExportPayload> & { zavodId: number },
): Promise<PushCreativeResult> {
  try {
    const baseUrl = getMcBaseUrl()
    const url = `${baseUrl}/api/zavod/creatives/${remoteId}`

    await $fetch(url, {
      method: "PUT",
      headers: getMcHeaders(),
      body: payload,
      timeout: 15_000,
    })

    return { ok: true, remoteId }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Не удалось обновить креатив в MarketingCamp"
    return { ok: false, error: message }
  }
}
