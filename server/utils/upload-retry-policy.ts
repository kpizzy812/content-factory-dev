/**
 * Политика автоповторов официальной публикации (Upload).
 *
 * Вынесена из планировщика отдельным модулем: решение «повторять или нет»
 * должно проверяться тестом без БД и без сети. Планировщик знает только
 * «можно/нельзя», всю классификацию держим здесь.
 */

/** Больше трёх автопопыток не делаем — дальше нужен человек (ручной retry). */
export const MAX_UPLOAD_ATTEMPTS = 3

/** Пауза перед следующей попыткой в минутах: после 1-й — 5, после 2-й — 15, дальше — 60. */
export const UPLOAD_RETRY_BACKOFF_MINUTES = [5, 15, 60] as const

/**
 * Ошибки, которые повтор не чинит: нет живого OAuth, аккаунт выключен, подпись
 * длиннее лимита площадки, у видео нет файла. Ретраить их — трижды сходить в
 * API и трижды записать ту же ошибку, спрятав от оператора реальную причину.
 */
const PERMANENT_ERROR_PATTERNS: RegExp[] = [
  // Нет живого OAuth: пока аккаунт не переподключат, повтор бессмыслен.
  /не подключ[её]н через официальный OAuth/i,
  /has no OAuth token/i,
  /OAuth-токены отсутствуют/i,
  /отсутствует refresh token/i,
  /token expired/i,
  // Аккаунт выключен на нашей стороне (expired / revoked).
  /неактивен/i,
  // Текст поста не влезает в лимит площадки — правится руками, не временем.
  /caption exceeds/i,
  // Заливать нечего или объекты пропали — это не транзиентный сбой.
  /не имеет сохранённого файла/i,
  /Upload \d+ не найден/i,
  /Видео для Upload \d+ не найдено/i,
  /Аккаунт для Upload \d+ не найден/i,
  // Публикация выключена флагом — это не провал попытки, а состояние среды.
  /ENABLE_SOCIAL_POSTING=false/i,
]

/** true — ошибка терминальная, автоповтор её не исправит. */
export function isPermanentUploadError(message: string | null | undefined): boolean {
  if (!message) return false
  return PERMANENT_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

/** Экспоненциальный backoff по числу уже сделанных попыток. */
export function uploadRetryDelayMs(attemptCount: number): number {
  const index = Math.min(
    Math.max(0, Math.floor(attemptCount) - 1),
    UPLOAD_RETRY_BACKOFF_MINUTES.length - 1,
  )
  return UPLOAD_RETRY_BACKOFF_MINUTES[index]! * 60_000
}

export interface FailedUploadSnapshot {
  attemptCount: number
  lastAttemptAt: Date | null
  errorMessage: string | null
}

export type UploadRetryDecision =
  | { retry: true; attempt: number }
  | { retry: false; reason: "permanent_error" | "attempts_exhausted" | "backoff"; readyAt?: Date }

/**
 * Решение по одной упавшей загрузке.
 * Порядок проверок важен: терминальную ошибку не имеет смысла ни считать по
 * попыткам, ни выдерживать по времени.
 */
export function planUploadRetry(
  upload: FailedUploadSnapshot,
  now: Date = new Date(),
): UploadRetryDecision {
  if (isPermanentUploadError(upload.errorMessage)) {
    return { retry: false, reason: "permanent_error" }
  }

  const attemptCount = Number.isFinite(upload.attemptCount)
    ? Math.max(0, Math.floor(upload.attemptCount))
    : 0
  if (attemptCount >= MAX_UPLOAD_ATTEMPTS) {
    return { retry: false, reason: "attempts_exhausted" }
  }

  // lastAttemptAt пуст, когда загрузка упала ещё до старта пайплайна —
  // выдерживать паузу не от чего, пробуем сразу.
  const lastAttemptMs = upload.lastAttemptAt?.getTime()
  if (typeof lastAttemptMs === "number" && Number.isFinite(lastAttemptMs)) {
    const readyAt = new Date(lastAttemptMs + uploadRetryDelayMs(attemptCount))
    if (readyAt.getTime() > now.getTime()) {
      return { retry: false, reason: "backoff", readyAt }
    }
  }

  return { retry: true, attempt: attemptCount + 1 }
}
