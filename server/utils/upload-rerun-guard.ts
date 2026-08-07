/**
 * Правила повторного запуска официальной публикации (Upload).
 *
 * Отдельный модуль, потому что решения тут принимаются в трёх разных местах
 * (пайплайн, планировщик, ручной retry), а проверяться должны без БД и без сети.
 * Всё, что здесь лежит, — чистые функции.
 */

import { MAX_UPLOAD_ATTEMPTS } from "./upload-retry-policy"

/**
 * Площадки, чей адаптер умеет продолжить прерванную публикацию.
 *
 * Критерий один: адаптер на входе смотрит params.resume и не заливает файл
 * второй раз, если публикация уже создана (tiktok.ts — short-circuit по
 * resume.postId и переиспользование publishId, instagram.ts — то же самое по
 * media id и containerId).
 *
 * YouTube в списке нет намеренно: youtube.ts делает resumable-init и один PUT
 * всего файла, params.resume не читает вообще. Если PUT долетел до Google, а
 * ответ потерялся (таймаут, 5xx, обрыв), ролик на канале уже создан, а у нас
 * останется failed с пустым platformPostId — второй прогон зальёт на канал
 * клиента дубль.
 */
const RESUMABLE_PLATFORMS = new Set(["tiktok", "instagram"])

/** true — у площадки есть идемпотентный resume, повтор не создаст дубль поста. */
export function isResumableUploadPlatform(platform: string | null | undefined): boolean {
  if (!platform) return false
  return RESUMABLE_PLATFORMS.has(platform.trim().toLowerCase())
}

/** Кто инициировал прогон: планировщик/оркестратор или человек кнопкой. */
export type UploadRunTrigger = "auto" | "manual"

export interface UploadRerunInput {
  platform: string | null | undefined
  /** Сколько попыток уже сделано по этой загрузке (значение из БД до прогона). */
  attemptCount: number
  trigger: UploadRunTrigger
}

export type UploadRerunDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Можно ли запускать заливку прямо сейчас.
 *
 * Разрешаем всегда, кроме одного случая: автоматический повтор на площадке без
 * идемпотентного resume. Там цена ошибки — лишний ролик на канале клиента,
 * который никто не удалит, поэтому запись остаётся в failed и ждёт оператора:
 * он сначала посмотрит канал, потом нажмёт «Повторить».
 */
export function checkUploadRerun(input: UploadRerunInput): UploadRerunDecision {
  if (input.trigger === "manual") return { allowed: true }

  const attemptCount = Number.isFinite(input.attemptCount)
    ? Math.max(0, Math.floor(input.attemptCount))
    : 0
  // Первый прогон: на площадку ещё ничего не уходило, дублировать нечего.
  if (attemptCount === 0) return { allowed: true }

  if (isResumableUploadPlatform(input.platform)) return { allowed: true }

  return {
    allowed: false,
    reason:
      `Автоповтор для площадки ${input.platform ?? "неизвестной"} запрещён: адаптер не умеет продолжать `
      + `прерванную публикацию, и повтор может залить дубль ролика. Попыток уже сделано: ${attemptCount}. `
      + `Проверьте канал вручную и, если ролика там нет, нажмите «Повторить».`,
  }
}

/**
 * Патч attemptCount для упавшей загрузки.
 *
 * Зачем не просто increment: планировщик отбирает кандидатов запросом
 * `status=failed AND attemptCount < MAX` и только потом отсеивает терминальные
 * ошибки в памяти. Записи с терминальной ошибкой при этом не меняются вообще —
 * их attemptCount навсегда остаётся 1, lastAttemptAt не двигается, и десяток
 * таких «мёртвых» загрузок занимает всю пачку тика насовсем: живой транзиентный
 * сбой не будет повторён ни разу. Поэтому выводим запись из выборки на уровне
 * БД — дотягиваем attemptCount до лимита. Ручной retry этим счётчиком не
 * ограничен, оператору кнопка остаётся доступной.
 *
 * @param attemptCounted попытка уже учтена в БД шагом «uploading»
 * @param attemptCountAfterRun каким attemptCount стал (или должен стать) после этого прогона
 */
export function planFailedUploadAttemptPatch(input: {
  permanent: boolean
  attemptCounted: boolean
  attemptCountAfterRun: number
}): Record<string, unknown> {
  const after = Number.isFinite(input.attemptCountAfterRun)
    ? Math.max(0, Math.floor(input.attemptCountAfterRun))
    : 0

  if (input.permanent) {
    return { attemptCount: Math.max(after, MAX_UPLOAD_ATTEMPTS) }
  }
  // Обычный транзиентный сбой: если шаг «uploading» не успел отработать,
  // попытку нужно досчитать здесь, иначе автоповтор крутил бы её без лимита.
  return input.attemptCounted ? {} : { attemptCount: { increment: 1 } }
}

/**
 * Через сколько загрузка в pending/uploading считается залипшей.
 *
 * Планировщик и оркестратор запускают пайплайн fire-and-forget уже после того,
 * как перевели запись в pending. Если процесс перезапустили в этот зазор
 * (деплой, OOM), запись остаётся в pending: тик выбирает только scheduled,
 * blocked_by_env и failed, то есть поднять её автоматически некому. Ручной
 * retry — единственный способ вернуть такую загрузку в жизнь.
 */
export const STUCK_UPLOAD_TIMEOUT_MS = 30 * 60_000

/** Статусы, из которых повтор разрешён всегда. */
const MANUAL_RETRY_STATUSES = ["failed", "blocked_by_env"]
/** Статусы «в работе»: повтор разрешён только если прогон завис. */
const IN_FLIGHT_STATUSES = ["pending", "uploading"]

export type ManualRetryDecision =
  | { allowed: true; stuck: boolean }
  | { allowed: false; message: string }

/**
 * Решение по ручному «Повторить».
 *
 * updatedAt берём как точку отсчёта, а не lastAttemptAt: у записи, залипшей в
 * pending, попытка ещё не начиналась и lastAttemptAt пуст (или остался от
 * прошлого прогона), а updatedAt Prisma проставляет на самом переходе в pending.
 */
export function planManualUploadRetry(
  upload: { status: string; updatedAt: Date | null },
  now: Date = new Date(),
): ManualRetryDecision {
  if (MANUAL_RETRY_STATUSES.includes(upload.status)) {
    return { allowed: true, stuck: false }
  }

  if (IN_FLIGHT_STATUSES.includes(upload.status)) {
    const updatedMs = upload.updatedAt?.getTime()
    const stuckSince = typeof updatedMs === "number" && Number.isFinite(updatedMs)
      ? now.getTime() - updatedMs
      : Number.POSITIVE_INFINITY
    if (stuckSince >= STUCK_UPLOAD_TIMEOUT_MS) {
      return { allowed: true, stuck: true }
    }
    return {
      allowed: false,
      message:
        `Загрузка сейчас выполняется (${upload.status}). Повтор станет доступен, если она зависнет `
        + `дольше ${Math.round(STUCK_UPLOAD_TIMEOUT_MS / 60_000)} минут.`,
    }
  }

  return {
    allowed: false,
    message:
      `Повторить можно загрузку со статусом ${MANUAL_RETRY_STATUSES.join("/")} `
      + `либо зависшую в ${IN_FLIGHT_STATUSES.join("/")}. Текущий: ${upload.status}`,
  }
}
