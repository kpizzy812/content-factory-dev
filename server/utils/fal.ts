import { isFalMockMode } from "./mock/mode"
import { mockFalPollUntilDone, mockFalSubmit } from "./mock/fal-mock"

interface FalQueueResponse {
  request_id: string
  status?: string
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
  error?: string
  logs?: Array<{ message: string; timestamp?: string; level?: string }>
}

export interface FalRequestMeta {
  requestId: string
  endpoint: string
  submittedAt: Date
}

export interface FalRequestResult<T> {
  data: T
  meta: FalRequestMeta
  completedAt: Date
}

const MAX_TIMEOUT_MS = 20 * 60 * 1000 // 20 минут — Kling text-to-video может занимать до 10-15 минут
const INITIAL_DELAY_MS = 2000
const MAX_DELAY_MS = 30_000

// Per-fetch HTTP timeout. Применяется к каждому одиночному запросу в fetchWithRetry —
// submit / status / result / cancel. Раньше отсутствовал, и pipeline #17 завис на TTS
// именно потому, что status-check fetch внутри loop поллинга держал socket без response
// бесконечно; верхний MAX_TIMEOUT_MS=20мин loop'а недостижим, если sleep+fetch висит.
// 60 секунд достаточно: status check у fal.ai отвечает за ~200мс, submit за 1-2с;
// если ответа нет за 60с — гарантированно проблема (network / провайдер залип).
const PER_FETCH_TIMEOUT_MS = 60_000

// Активные запросы для отмены
const activeRequests = new Map<string, { aborted: boolean }>()

/**
 * Базовый URL для queue-операций (status / result / cancel).
 *
 * fal.ai в submit response САМ возвращает status_url / cancel_url / response_url,
 * и для ВСЕХ моделей путь там обрезан до owner/первого-alias:
 *   - fal-ai/flux/schnell                          → fal-ai/flux/requests/...
 *   - fal-ai/kling-video/v3/standard/text-to-video → fal-ai/kling-video/requests/...
 *   - fal-ai/playai/tts/v3                         → fal-ai/playai/requests/...
 *
 * Это канонический формат fal queue API: первые 2 сегмента — namespace, всё что
 * глубже — model variant, который привязан к request_id, но не к URL.
 *
 * Submit при этом идёт на ПОЛНЫЙ endpoint (queue.fal.run/fal-ai/flux/schnell) —
 * там variant нужен. Так что асимметрия submit/status — by design fal.ai.
 *
 * Проверено curl'ом 2026-04-27: GET status по полному URL даёт 405 для FLUX/Kling.
 *
 * Прежний фикс be25ff8 (возвращал полный endpoint в status URL) был основан на
 * ошибочной диагностике — реальный fal.ai SDK обрезает до 2 сегментов.
 */
function parseQueueBaseUrl(endpoint: string): string {
  const segments = endpoint.split("/").filter(s => s.length > 0)
  // Минимум 2 сегмента (owner/alias) — для известных моделей всегда так.
  // Если короче — возвращаем как есть (нечего обрезать), хотя такие endpoints
  // в нашем реестре отсутствуют.
  const head = segments.length >= 2 ? segments.slice(0, 2).join("/") : endpoint
  return `https://queue.fal.run/${head}`
}

function getAuthHeader(): Record<string, string> {
  const falKey = process.env.FAL_KEY || ""

  if (!falKey) {
    throw createError({
      statusCode: 500,
      message: "API-ключ fal.ai не настроен. Установите FAL_KEY в .env",
    })
  }

  return {
    "Authorization": `Key ${falKey}`,
    "Content-Type": "application/json",
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Извлекает структурированные поля из ошибки ofetch / fetch.
 * fal.ai возвращает JSON с полем `detail`, которое содержит реальную причину
 * (Exhausted balance / Model not available / Rate limit / Invalid params).
 * Раньше этот detail выкидывался и подменялся универсальным сообщением —
 * 14 мая 2026 это привело к 1.5 часам диагностики "нет доступа к модели",
 * когда реальная причина была "Exhausted balance". Теперь detail всегда
 * пробрасывается приоритетно.
 */
function extractFalErrorInfo(error: unknown): {
  status: number | undefined
  detail: string | undefined
  rawBody: unknown
} {
  if (typeof error !== "object" || error === null) {
    return { status: undefined, detail: undefined, rawBody: error }
  }
  const err = error as Record<string, unknown>
  const response = err.response as Record<string, unknown> | undefined
  const data = err.data as Record<string, unknown> | undefined
  const responseData = response?._data as Record<string, unknown> | undefined
  const body = err.body as Record<string, unknown> | undefined

  const status = (response?.status as number | undefined)
    ?? (err.statusCode as number | undefined)
    ?? (err.status as number | undefined)

  const detailCandidate = data?.detail ?? responseData?.detail ?? body?.detail ?? err.detail
  const detail = typeof detailCandidate === "string" ? detailCandidate : undefined

  const rawBody = data ?? responseData ?? body ?? null

  return { status, detail, rawBody }
}

/**
 * Классифицирует ошибку fal.ai в понятное сообщение для UI/pipeline log.
 *
 * Приоритет: `detail` от fal.ai > классификация по HTTP-статусу > generic.
 * Это критично — без `detail` оператор получает дезинформацию (например,
 * "нет доступа к модели" при реально исчерпанном балансе).
 */
export function classifyFalError(error: unknown, url: string): string {
  const { status, detail } = extractFalErrorInfo(error)

  const endpointMatch = url.match(/queue\.fal\.run\/(.+?)(?:\/requests|$)/)
  const endpoint = endpointMatch?.[1] ?? url

  if (detail) {
    if (/exhausted balance|user is locked|insufficient credit/i.test(detail)) {
      return `💰 Баланс fal.ai исчерпан. ${detail} Пополните на fal.ai/dashboard/billing.`
    }
    if (/model.*not available|not authorized for this model|no access to/i.test(detail)) {
      return `🔒 Нет доступа к модели ${endpoint}: ${detail}`
    }
    if (/rate limit|too many requests/i.test(detail)) {
      return `⏱️ fal.ai rate limit: ${detail}`
    }
    return `fal.ai error (HTTP ${status ?? "?"}, ${endpoint}): ${detail}`
  }

  if (status === 403) {
    return `Нет доступа к модели fal.ai (${endpoint}): HTTP 403 Forbidden без подробностей от fal.ai. `
      + `Проверьте баланс аккаунта, доступ к модели и валидность API key.`
  }
  if (status === 401) {
    return `API-ключ fal.ai невалиден или истёк. HTTP 401 Unauthorized. Проверьте FAL_KEY в .env.`
  }
  if (status === 422) {
    return `Невалидные параметры запроса к fal.ai (${endpoint}). HTTP 422 Unprocessable Entity.`
  }
  if (status === 429) {
    return `Превышен лимит запросов fal.ai. HTTP 429 Too Many Requests.`
  }
  return `Ошибка fal.ai: HTTP ${status ?? "unknown"}`
}

async function fetchWithRetry<T>(
  url: string,
  options: Record<string, unknown>,
  retries = 1,
): Promise<T> {
  const doFetch = async (): Promise<T> => {
    // AbortController даёт hard per-fetch timeout — без него Node может держать
    // socket open до OS-level keepalive timeout (часы). Pipeline #17 завис именно
    // потому что одиночный status check не имел timeout и блокировал весь poll loop.
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(new Error(`HTTP timeout after ${PER_FETCH_TIMEOUT_MS}ms`)),
      PER_FETCH_TIMEOUT_MS,
    )
    try {
      const mergedOptions = {
        ...options,
        signal: controller.signal,
      } as Parameters<typeof $fetch>[1]
      const res = await $fetch.raw(url, mergedOptions)
      return res._data as T
    } finally {
      clearTimeout(timeoutId)
    }
  }

  try {
    return await doFetch()
  } catch (error: unknown) {
    const { status, detail, rawBody } = extractFalErrorInfo(error)

    // 4xx (кроме 429): понятная ошибка без retry. Логируем full body для DevOps —
    // classifyFalError ниже выкидывает rawBody, и без этого лога мы теряем
    // структурированный response (fields beyond `detail`, диагностические подсказки fal.ai).
    if (status === 403 || status === 401 || status === 422) {
      console.error("[fal] Request failed", {
        url,
        status,
        detail,
        rawBody,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      throw new Error(classifyFalError(error, url))
    }

    // 429: ждать retry-after
    if (status === 429) {
      const retryAfter = (error as { response?: { headers?: { get: (k: string) => string | null } } })
        ?.response?.headers?.get("retry-after")
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5000
      await sleep(Math.min(waitMs, 30_000))
      return await doFetch()
    }

    // 5xx: retry один раз
    if (status && status >= 500 && retries > 0) {
      await sleep(2000)
      return fetchWithRetry<T>(url, options, retries - 1)
    }

    // Network errors / per-fetch timeout (AbortError) — retry-able, потому что
    // обычно это transient socket issue (DNS hiccup, провайдер залип, прокси сбой).
    // Без этой ветки одиночный network failure ронял весь pipeline step.
    if (status === undefined && retries > 0 && isTransientNetworkError(error)) {
      await sleep(2000)
      return fetchWithRetry<T>(url, options, retries - 1)
    }

    throw error
  }
}

function isTransientNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as Record<string, unknown>
  const code = typeof e.code === "string" ? e.code : ""
  const name = typeof e.name === "string" ? e.name : ""
  const message = err instanceof Error ? err.message : ""

  // AbortError — наш hard per-fetch timeout сработал
  if (name === "AbortError") return true
  // Стандартные Node network error codes
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED") return true
  if (code === "EAI_AGAIN" || code === "ENOTFOUND") return true
  if (code === "UND_ERR_SOCKET" || code === "UND_ERR_CONNECT_TIMEOUT") return true
  // Текстовая классификация — undici/ofetch иногда не выставляют code
  if (/socket hang up|network|fetch failed|timeout/i.test(message)) return true
  return false
}

/**
 * Загружает локальный файл в fal.ai storage и возвращает публичный URL.
 * Используется для моделей, которые требуют publicly-accessible URL на input
 * (sync-lipsync, video-to-video и т.п.) — а у нас локальные пути storage/uploads/.
 *
 * Двухходовая операция:
 *   1) POST /storage/upload/initiate → получаем signed upload_url + file_url
 *   2) PUT upload_url с binary → fal.ai сохраняет файл, file_url становится готов
 */
export async function falUploadFile(filePath: string, contentType: string): Promise<string> {
  if (isFalMockMode()) {
    console.log(`[fal-mock] uploadFile ${filePath} (${contentType})`)
    return `mock://upload/${Math.random().toString(36).slice(2)}`
  }

  requirePaidApisEnabled("fal.ai")

  const { readFile } = await import("node:fs/promises")
  const { basename } = await import("node:path")

  const falKey = process.env.FAL_KEY || ""
  if (!falKey) {
    throw createError({
      statusCode: 500,
      message: "API-ключ fal.ai не настроен. Установите FAL_KEY в .env",
    })
  }

  // Step 1: initiate
  const initResp = await $fetch<{ upload_url: string; file_url: string }>(
    "https://rest.alpha.fal.ai/storage/upload/initiate",
    {
      method: "POST",
      headers: {
        "Authorization": `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: {
        content_type: contentType,
        file_name: basename(filePath),
      },
    },
  )
  if (!initResp?.upload_url || !initResp?.file_url) {
    throw new Error("fal.ai storage/upload/initiate не вернул upload_url/file_url")
  }

  // Step 2: PUT binary
  const buf = await readFile(filePath)
  await $fetch(initResp.upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buf,
  })

  return initResp.file_url
}

/**
 * Submit задачу в fal.ai queue и вернуть requestId.
 * Не ждёт результата — для persisted tracking.
 */
export async function falSubmit(endpoint: string, input: object): Promise<FalRequestMeta> {
  if (isFalMockMode()) {
    void input
    return mockFalSubmit(endpoint)
  }

  requirePaidApisEnabled("fal.ai")

  const headers = getAuthHeader()
  const submitUrl = `https://queue.fal.run/${endpoint}`

  const submitResponse = await fetchWithRetry<FalQueueResponse>(submitUrl, {
    method: "POST",
    headers,
    body: input,
  })

  const requestId = submitResponse.request_id
  if (!requestId) {
    throw new Error(`fal.ai: не получен request_id при submit на ${endpoint}`)
  }

  activeRequests.set(requestId, { aborted: false })

  return {
    requestId,
    endpoint,
    submittedAt: new Date(),
  }
}

/**
 * Проверить статус fal.ai запроса.
 */
export async function falCheckStatus(endpoint: string, requestId: string): Promise<FalStatusResponse> {
  if (isFalMockMode()) {
    void requestId
    void endpoint
    return { status: "COMPLETED" }
  }
  const headers = getAuthHeader()
  const baseUrl = parseQueueBaseUrl(endpoint)

  return fetchWithRetry<FalStatusResponse>(
    `${baseUrl}/requests/${requestId}/status?logs=1`,
    { method: "GET", headers },
  )
}

/**
 * Получить результат завершённого fal.ai запроса.
 */
export async function falGetResult<T>(endpoint: string, requestId: string): Promise<T> {
  if (isFalMockMode()) {
    const r = await mockFalPollUntilDone<T>(endpoint, requestId)
    return r.data
  }
  const headers = getAuthHeader()
  const baseUrl = parseQueueBaseUrl(endpoint)

  return fetchWithRetry<T>(
    `${baseUrl}/requests/${requestId}`,
    { method: "GET", headers },
  )
}

/**
 * Отменить fal.ai запрос.
 */
export async function falCancel(endpoint: string, requestId: string): Promise<void> {
  const ctrl = activeRequests.get(requestId)
  if (ctrl) ctrl.aborted = true

  const headers = getAuthHeader()
  const baseUrl = parseQueueBaseUrl(endpoint)

  try {
    await fetchWithRetry<unknown>(
      `${baseUrl}/requests/${requestId}/cancel`,
      { method: "PUT", headers },
    )
  } catch {
    // fal.ai может не поддерживать cancel для всех endpoint — не критично
  } finally {
    activeRequests.delete(requestId)
  }
}

/**
 * Poll fal.ai запрос до завершения. Возвращает результат и логи.
 * Опционально принимает callback для обновления статуса.
 * externalSignal — AbortSignal от pipeline cancel registry для немедленной остановки polling.
 */
export async function falPollUntilDone<T>(
  endpoint: string,
  requestId: string,
  onStatusUpdate?: (status: FalStatusResponse) => void | Promise<void>,
  externalSignal?: AbortSignal,
): Promise<FalRequestResult<T>> {
  if (isFalMockMode()) {
    if (onStatusUpdate) {
      await onStatusUpdate({ status: "IN_PROGRESS" })
    }
    const result = await mockFalPollUntilDone<T>(endpoint, requestId)
    if (onStatusUpdate) {
      await onStatusUpdate({ status: "COMPLETED" })
    }
    return result
  }
  const headers = getAuthHeader()
  const baseUrl = parseQueueBaseUrl(endpoint)

  const startTime = Date.now()
  let delay = INITIAL_DELAY_MS

  while (Date.now() - startTime < MAX_TIMEOUT_MS) {
    // Проверка отмены — internal flag + external signal
    const ctrl = activeRequests.get(requestId)
    if (ctrl?.aborted || externalSignal?.aborted) {
      // Попытка отменить remote job
      await falCancel(endpoint, requestId).catch(() => {})
      throw new Error(`fal.ai: запрос ${requestId} отменён`)
    }

    await sleep(delay)

    // Перепроверяем после sleep — могли отменить во время ожидания
    if (externalSignal?.aborted) {
      await falCancel(endpoint, requestId).catch(() => {})
      throw new Error(`fal.ai: запрос ${requestId} отменён`)
    }

    const statusResponse = await fetchWithRetry<FalStatusResponse>(
      `${baseUrl}/requests/${requestId}/status?logs=1`,
      { method: "GET", headers },
    )

    if (onStatusUpdate) {
      await onStatusUpdate(statusResponse)
    }

    if (statusResponse.status === "COMPLETED") {
      const result = await fetchWithRetry<T>(
        `${baseUrl}/requests/${requestId}`,
        { method: "GET", headers },
      )

      activeRequests.delete(requestId)

      return {
        data: result,
        meta: {
          requestId,
          endpoint,
          submittedAt: new Date(startTime),
        },
        completedAt: new Date(),
      }
    }

    if (statusResponse.status === "FAILED") {
      activeRequests.delete(requestId)
      throw new Error(`fal.ai: задача ${requestId} завершилась с ошибкой: ${statusResponse.error || "неизвестная ошибка"}`)
    }

    delay = Math.min(delay * 2, MAX_DELAY_MS)
  }

  activeRequests.delete(requestId)
  throw new Error(`fal.ai: таймаут (${MAX_TIMEOUT_MS / 1000}с) для ${endpoint}, задача ${requestId}`)
}

/**
 * Переподключение к существующему fal.ai запросу.
 * Проверяет статус, если COMPLETED — возвращает результат.
 * Если IN_QUEUE/IN_PROGRESS — продолжает polling.
 * Если FAILED — возвращает null (нужен новый submit).
 */
export async function falReattach<T>(
  endpoint: string,
  requestId: string,
  onStatusUpdate?: (status: FalStatusResponse) => void | Promise<void>,
): Promise<FalRequestResult<T> | null> {
  try {
    const status = await falCheckStatus(endpoint, requestId)

    if (onStatusUpdate) {
      await onStatusUpdate(status)
    }

    if (status.status === "COMPLETED") {
      const data = await falGetResult<T>(endpoint, requestId)
      return {
        data,
        meta: { requestId, endpoint, submittedAt: new Date() },
        completedAt: new Date(),
      }
    }

    if (status.status === "FAILED") {
      return null // Нужен новый submit
    }

    // IN_QUEUE или IN_PROGRESS — продолжаем polling
    return await falPollUntilDone<T>(endpoint, requestId, onStatusUpdate)
  } catch {
    // Не удалось проверить статус — remote job скорее всего протух
    return null
  }
}

/**
 * Полный цикл fal.ai Queue API: submit -> poll -> result.
 * Обратная совместимость с текущим кодом.
 */
export async function falRequest<T>(endpoint: string, input: object): Promise<T> {
  const meta = await falSubmit(endpoint, input)
  const result = await falPollUntilDone<T>(endpoint, meta.requestId)
  return result.data
}

// ─── Model Access Probing ─────────────────────────────

import type { ModelAccessStatus } from "~~/shared/types/video"

interface ModelAccessResult {
  status: ModelAccessStatus
  reason: string
  endpoint: string
  checkedAt: Date
}

/**
 * Кэш результатов проверки доступа к моделям.
 * TTL = 5 минут — достаточно для UI, не нагружает fal.ai.
 */
const accessCache = new Map<string, { result: ModelAccessResult; expiresAt: number }>()
const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Лёгкая проверка доступности модели fal.ai для текущего ключа.
 *
 * Стратегия: запрашиваем статус несуществующего request_id.
 * - 403 → ключ не имеет доступа к этой модели
 * - 404/422 → модель доступна (ключ имеет право, request просто не найден)
 * - 401 → невалидный ключ
 * - Другие ошибки → неопределённо
 */
export async function falProbeAccess(endpoint: string): Promise<ModelAccessResult> {
  if (isFalMockMode()) {
    return {
      status: "available",
      reason: "Модель доступна (mock mode)",
      endpoint,
      checkedAt: new Date(),
    }
  }
  // Проверяем кэш
  const cached = accessCache.get(endpoint)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  if (!process.env.FAL_KEY) {
    const result: ModelAccessResult = {
      status: "no_api_key",
      reason: "API-ключ fal.ai не настроен (FAL_KEY)",
      endpoint,
      checkedAt: new Date(),
    }
    accessCache.set(endpoint, { result, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS })
    return result
  }

  const headers = getAuthHeader()
  const baseUrl = parseQueueBaseUrl(endpoint)
  const probeUrl = `${baseUrl}/requests/probe-nonexistent-000/status`

  try {
    await $fetch.raw(probeUrl, { method: "GET", headers })
    // Если вдруг 200 — модель точно доступна (маловероятно)
    const result: ModelAccessResult = {
      status: "available",
      reason: "Модель доступна",
      endpoint,
      checkedAt: new Date(),
    }
    accessCache.set(endpoint, { result, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS })
    return result
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status
      ?? (error as { statusCode?: number })?.statusCode

    let result: ModelAccessResult

    if (status === 403) {
      result = {
        status: "blocked_by_access",
        reason: "Ключ fal.ai не имеет доступа к этой модели. Проверьте план/workspace вашего аккаунта fal.ai.",
        endpoint,
        checkedAt: new Date(),
      }
    } else if (status === 401) {
      result = {
        status: "no_api_key",
        reason: "API-ключ fal.ai невалиден или истёк",
        endpoint,
        checkedAt: new Date(),
      }
    } else if (status === 404 || status === 422) {
      // На 2026-05-14 fal.ai отдаёт 404 на пробинг GET /requests/{несуществующий_id}/status
      // (раньше — с конца апреля 2026 — был 405). Оба статуса значат "ключ валиден,
      // модель экзистенциально доступна, request_id просто не найден". Probe-стратегия
      // через несуществующий request_id не различает available/no_access/no_api_key,
      // если fal.ai отвечает 4xx без 403/401: считаем модель доступной и доверяем
      // реальному submit'у — 401/403 прилетят там, без задержки на polling.
      result = {
        status: "available",
        reason: "Модель доступна",
        endpoint,
        checkedAt: new Date(),
      }
    } else if (status === 405) {
      // Legacy fallback: исторически (конец апреля 2026) fal.ai отвечал 405
      // Method Not Allowed на этот же probe URL. Оставляем явную ветку на случай
      // отката поведения — семантически идентично 404.
      result = {
        status: "available",
        reason: "Probe ответил 405 (legacy). Модель будет проверена при первом submit.",
        endpoint,
        checkedAt: new Date(),
      }
    } else {
      result = {
        status: "probe_error",
        reason: `Не удалось проверить доступ (HTTP ${status ?? "unknown"})`,
        endpoint,
        checkedAt: new Date(),
      }
    }

    // probe_error кэшировать НЕЛЬЗЯ: transient HTTP 405/5xx залипал бы на 5 минут
    // и блокировал все resume. Кэшируем только однозначные вердикты.
    if (result.status !== "probe_error") {
      accessCache.set(endpoint, { result, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS })
    }
    return result
  }
}

/**
 * Проверка доступа к нескольким моделям параллельно.
 */
export async function falProbeAccessBatch(
  endpoints: string[],
): Promise<Map<string, ModelAccessResult>> {
  const results = await Promise.all(
    endpoints.map(async (ep) => [ep, await falProbeAccess(ep)] as const),
  )
  return new Map(results)
}

/**
 * Сбросить кэш доступа (например, после смены ключа).
 */
export function falClearAccessCache(): void {
  accessCache.clear()
}
