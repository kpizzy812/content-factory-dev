/**
 * Pure state machine для PostingJob.
 *
 * - canTransition: разрешён ли переход status A → B.
 * - isTerminal: достигнут ли финальный статус (нет переходов).
 * - shouldRetry: нужно ли запланировать retry для упавшего job.
 * - nextRetryAt: рассчёт времени следующей попытки (exponential backoff).
 *
 * Не работает с БД, не имеет side-effects. Удобно покрывать unit-тестами.
 */

import type { PostingErrorCategory, PostingJobStatus } from "../../../app/generated/prisma/client"

/**
 * Допустимые переходы между статусами.
 *
 * scheduled → queued — наступило время публикации (worker обнаружил scheduledAt <= now)
 * queued → preparing — worker захватил job (атомарный claim)
 * preparing → uploading — pre-flight checks прошли, отправка на runner начата
 * uploading → published — runner вернул success
 * uploading → failed — runner вернул non-retryable ошибку
 * uploading → retry_queued — runner вернул retryable ошибку, попытки ещё есть
 * retry_queued → queued — наступило retryAt
 * preparing → failed — pre-flight checks провалились (например, прокси dead, non-retryable)
 * preparing → retry_queued — pre-flight упал retryable ошибкой (например, network_error)
 * failed → retry_queued — manual retry оператором (через API endpoint)
 * failed → cancelled — оператор снимает failed-job с retry, сохраняя запись (P1, D-a)
 * any non-terminal → cancelled — оператор отменил job вручную
 */
const ALLOWED_TRANSITIONS: Record<PostingJobStatus, PostingJobStatus[]> = {
  scheduled: ["queued", "cancelled"],
  queued: ["preparing", "cancelled"],
  preparing: ["uploading", "failed", "retry_queued", "cancelled"],
  uploading: ["published", "failed", "retry_queued", "cancelled"],
  retry_queued: ["queued", "cancelled"],
  failed: ["retry_queued", "cancelled"],
  // Terminal:
  published: [],
  cancelled: [],
}

const TERMINAL_STATUSES: PostingJobStatus[] = ["published", "cancelled"]

/**
 * Категории ошибок, для которых имеет смысл retry без вмешательства человека.
 * Остальные категории требуют ручного действия (поменять прокси, разлочить аккаунт и т.п.).
 */
const RETRYABLE_CATEGORIES: PostingErrorCategory[] = [
  "network_error",
  "platform_5xx",
  "platform_rate_limit",
  // Part D: upload_failed (transient timeout TikTok upload) — retry 1 раз через 5 мин.
  // Реальный лимит контролируется maxAttempts: первой попыткой исчерпывает counter
  // если runner.maxAttempts=2 — runner делает 2 попытки итого. selector_not_found /
  // login_required / browser_connect_failed — НЕ retryable, оператор должен фиксить.
  "upload_failed",
]

/**
 * Backoff между попытками. Длина массива — сколько раз можно retry сверх attemptCount=1.
 * После исчерпания backoff'а job уходит в failed окончательно.
 */
const RETRY_BACKOFF_MS = [
  60 * 1000, //   1 мин
  5 * 60 * 1000, //   5 мин
  30 * 60 * 1000, //  30 мин
  2 * 60 * 60 * 1000, //   2 часа
  12 * 60 * 60 * 1000, //  12 часов
]

export function canTransition(from: PostingJobStatus, to: PostingJobStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminal(status: PostingJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * @param category категория ошибки
 * @param attemptCount счётчик ПОСЛЕ неудачной попытки (то есть уже инкрементированный)
 * @param maxAttempts лимит общего числа попыток
 */
export function shouldRetry(
  category: PostingErrorCategory | null | undefined,
  attemptCount: number,
  maxAttempts: number,
): boolean {
  if (!category) return false
  if (!RETRYABLE_CATEGORIES.includes(category)) return false
  return attemptCount < maxAttempts
}

/**
 * Рассчитать время следующей попытки.
 *
 * @param attemptCount уже сделанное число попыток. Т.е. для расчёта delay перед 2-й попыткой
 *                     передаём 1 (одну попытку уже сделали — берём backoff[0]).
 */
export function nextRetryAt(attemptCount: number): Date {
  const idx = Math.min(Math.max(attemptCount - 1, 0), RETRY_BACKOFF_MS.length - 1)
  const delayMs = RETRY_BACKOFF_MS[idx]!
  return new Date(Date.now() + delayMs)
}

export const POSTING_RETRYABLE_CATEGORIES = RETRYABLE_CATEGORIES
