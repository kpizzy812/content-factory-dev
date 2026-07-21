/**
 * Эвристический классификатор ошибок PostingJob.
 *
 * Берёт raw error (Error | string | { code, message }) и возвращает PostingErrorCategory.
 * Классификация определяет shouldRetry в state-machine.
 */

import type { PostingErrorCategory } from "../../../app/generated/prisma/client"

/**
 * Ошибка прод-попытки API-постинга. Реального API-раннера не существует
 * (IG/TikTok постят только через browser_automation), поэтому в проде ветка
 * postingMethod=api честно валит job терминально вместо фейкового «published».
 *
 * Несёт structured category="internal_error" → categorizeError вернёт терминальную
 * (НЕ retryable) категорию, job не зациклится в retry.
 */
export class ApiPostingUnsupportedError extends Error {
  readonly category: PostingErrorCategory = "internal_error"
  constructor(message: string) {
    super(message)
    this.name = "ApiPostingUnsupportedError"
  }
}

interface ErrorLike {
  message?: unknown
  code?: unknown
  status?: unknown
  statusCode?: unknown
  /** Part D: structured category из PostingPhaseError. */
  category?: unknown
  /** Этап 3 (P5): terminal-флаг AdbEngineError (DuoPlus-движок). */
  terminal?: unknown
}

/**
 * Этап 3 (P5): маппинг кода/terminal-флага AdbEngineError (DuoPlus ADB-движок) в
 * persisted PostingErrorCategory, согласованный с retry-policy state-machine.
 *
 * Принцип: terminal=true → НЕ retryable (повтор бессмыслен — config error /
 * неоплата / нереализованный постер); terminal=false → retryable (транзиентный
 * сбой powerOn/curl/сети устройства).
 *
 * - device_config_error / poster_not_implemented (terminal) → internal_error (terminal).
 * - device_power_failed / media_push_failed (retryable)     → network_error
 *   (входит в RETRYABLE_CATEGORIES → shouldRetry с backoff).
 *
 * Используется и в poster-runner (выставить PostingPhaseError.category при
 * обёртке AdbEngineError), и здесь как fallback для сырого AdbEngineError.
 */
export function adbEngineCategory(
  code: string,
  terminal: boolean,
): PostingErrorCategory {
  if (terminal) return "internal_error"
  return "network_error"
}

/**
 * Этап 3 (per-device кулдаун): задержка повтора для device_busy / device_cooldown.
 *
 * DuoPlus после постинга уходит в configuring на ~180с+; вторая джоба на то же
 * устройство получает media-push sshExecError. Pre-check в powerOnDevice ловит
 * это как retryable AdbEngineError (DEVICE_BUSY / DEVICE_COOLDOWN), но обычный
 * generic-backoff (1 мин на первой попытке) повторил бы слишком рано — устройство
 * ещё занято/configuring. Держим ≥180с, чтобы попасть в окно, когда устройство
 * освободится/доконфигурируется. QPS=1 на DuoPlus → редкие крупные интервалы
 * предпочтительнее частого молочения списка.
 */
export const DEVICE_COOLDOWN_RETRY_MS = 180_000

/**
 * Распознаёт device-кулдаун/занятость (DuoPlus pre-check) по сырому AdbEngineError
 * (code device_busy/device_cooldown) ИЛИ по обёрнутому PostingPhaseError, в message
 * которого poster-runner проставляет стабильный маркер `[adb:device_busy]` /
 * `[adb:device_cooldown]`. Code-based, не зависит от человеческого текста.
 */
export function isDeviceCooldownError(err: unknown): boolean {
  if (isAdbEngineError(err)) {
    return err.code === "device_busy" || err.code === "device_cooldown"
  }
  const msg = getMessage(err)
  return msg.includes("[adb:device_busy]") || msg.includes("[adb:device_cooldown]")
}

/** Узнаём AdbEngineError по форме (name + code + terminal). Без импорта движка. */
function isAdbEngineError(
  err: unknown,
): err is { code: string; terminal: boolean } {
  if (!err || typeof err !== "object") return false
  const e = err as ErrorLike & { name?: unknown }
  return (
    e.name === "AdbEngineError" &&
    typeof e.code === "string" &&
    typeof e.terminal === "boolean"
  )
}

function getMessage(err: unknown): string {
  if (!err) return ""
  if (typeof err === "string") return err.toLowerCase()
  const parts: string[] = []
  if (err instanceof Error) {
    parts.push(err.message || "")
    // DuoplusCommandError несёт stdout устройства в .content — там тексты
    // Android-исключений (NPE и т.п.), которых нет в message.
    const c = (err as { content?: unknown }).content
    if (typeof c === "string") parts.push(c)
  }
  if (typeof err === "object") {
    const e = err as ErrorLike & { content?: unknown }
    if (typeof e.message === "string") parts.push(e.message)
    if (typeof e.code === "string") parts.push(e.code)
    if (typeof e.content === "string") parts.push(e.content)
    // Вложенные поля DuoPlus-ошибки (extra/des/extraDes) — собираем сериализацией,
    // чтобы поймать Android-исключение, где бы оно ни лежало.
    try { parts.push(JSON.stringify(err)) } catch { /* circular ref — пропускаем */ }
  }
  if (parts.length === 0) return String(err).toLowerCase()
  return parts.join(" ").toLowerCase()
}

function getStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null
  const e = err as ErrorLike
  if (typeof e.status === "number") return e.status
  if (typeof e.statusCode === "number") return e.statusCode
  return null
}

function getCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null
  const e = err as ErrorLike
  return typeof e.code === "string" ? e.code : null
}

/**
 * Категоризация ошибок:
 *
 * - proxy_dead: упоминания proxy/tunnel/leak
 * - auth_failed: 401, "unauthorized", "session expired"
 * - account_locked: "captcha", "locked", "blocked", "banned"
 * - platform_rate_limit: 429, "rate limit", "too many requests"
 * - platform_5xx: 5xx HTTP коды
 * - content_rejected: "rejected", "policy violation", "invalid content"
 * - platform_validation: 400/422, "validation", "invalid"
 * - network_error: ECONNREFUSED, ETIMEDOUT, ECONNRESET, EAI_AGAIN, "timeout", "network"
 * - unknown: всё остальное
 */
export function categorizeError(err: unknown): PostingErrorCategory {
  // Этап 3 (P5): сырой AdbEngineError (DuoPlus-движок) — приоритет над всем.
  // poster-runner обычно оборачивает его в PostingPhaseError с уже выставленной
  // category (ветка structured ниже), но если AdbEngineError всплыл напрямую —
  // классифицируем по terminal-флагу. Раньше эвристики, т.к. message ADB-ошибок
  // («powerOn ... провалился») мог бы ложно матчить network/etc.
  if (isAdbEngineError(err)) {
    return adbEngineCategory(err.code, err.terminal)
  }

  const msg = getMessage(err)
  const code = getCode(err)
  const status = getStatus(err)

  // Детерминированный код-баг на устройстве (Android-исключение в shell-команде:
  // NPE «Attempt to get length of null array» в input text и т.п.) — повтор даст
  // ТУ ЖЕ ошибку и зря жжёт минуты телефона. Терминально (internal_error, НЕ
  // retryable), в отличие от транзиентного sshExecError ниже. Проверяем РАНО —
  // раньше structured category и sshExecError, чтобы такая ошибка не зацикливалась
  // в network_error→retry (защита денег: телефон не будится по 5 раз впустую).
  if (msg.includes("nullpointerexception") || msg.includes("inputshellcommand")) {
    return "internal_error"
  }

  // Part D: structured category из PostingPhaseError. Имеет приоритет над heuristic.
  // proxy_dead добавлен для inline browser_leak_check (Phase 1 youtube-poster):
  // Chromium показал реальный IP сервера → пост ОТМЕНЁН (бан гарантирован).
  // Не retryable — оператор должен починить Indigo profile / прокси.
  if (err && typeof err === "object") {
    const e = err as ErrorLike
    if (typeof e.category === "string") {
      const c = e.category as PostingErrorCategory
      if (
        c === "login_required" ||
        c === "browser_connect_failed" ||
        c === "selector_not_found" ||
        c === "upload_failed" ||
        c === "network_error" ||
        c === "proxy_dead" ||
        // internal_error — терминальная (НЕ retryable). Используется
        // ApiPostingUnsupportedError для прод-ветки postingMethod=api.
        c === "internal_error"
      ) {
        return c
      }
    }
  }

  if (msg.includes("proxy") || msg.includes("tunnel") || msg.includes("leak")) {
    return "proxy_dead"
  }

  if (status === 401 || msg.includes("unauthorized") || msg.includes("session expired") || msg.includes("invalid token")) {
    return "auth_failed"
  }

  if (msg.includes("captcha") || msg.includes("locked") || msg.includes("banned") || msg.includes("suspended")) {
    return "account_locked"
  }

  if (status === 429 || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("throttle")) {
    return "platform_rate_limit"
  }

  if (status !== null && status >= 500 && status < 600) {
    return "platform_5xx"
  }

  if (msg.includes("rejected") || msg.includes("policy violation") || msg.includes("content not allowed")) {
    return "content_rejected"
  }

  if (status === 400 || status === 422 || msg.includes("validation") || msg.includes("invalid request")) {
    return "platform_validation"
  }

  const networkCodes = ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "EHOSTUNREACH"]
  if (
    (code && networkCodes.includes(code)) ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("network") ||
    msg.includes("socket hang up")
  ) {
    return "network_error"
  }

  // DuoPlus ADB-команда упала на устройстве (sshExecError/agentError от cloudPhone
  // command) — обычно транзиентно (устройство занято / команда не выполнилась) →
  // retryable, а не глухой unknown→failed. Сам код-баг (напр. пустой input text)
  // чинится отдельно; здесь — безопасный дефолт для команд-сбоев.
  if (msg.includes("sshexecerror") || msg.includes("agenterror") || msg.includes("execerror")) {
    return "network_error"
  }

  // Internal сейчас намеренно не выводим из текста — Internal = ошибка нашего кода,
  // её бросает только наш validateJobPreconditions / transitionJob.
  return "unknown"
}
