/**
 * Ключи попыток для идемпотентных prediction'ов Replicate.
 *
 * Идемпотентный ключ считается из отпечатков исходников (видео + аудио + модель),
 * поэтому он стабилен по построению — в этом и был смысл: два параллельных
 * прогона одного ролика не должны оплачиваться дважды. Обратная сторона: если
 * попытка закончилась терминальной ошибкой на стороне Replicate, запись с этим
 * ключом навсегда остаётся в статусе failed. Повторный запуск читает её и падает
 * мгновенно, не дойдя до провайдера — ролик становится невосстановимым.
 *
 * Лечим производными ключами: у каждой следующей попытки свой ключ, внутри
 * попытки идемпотентность прежняя. Потолок нужен, чтобы систематическая ошибка
 * (битый исходник, снятая модель) не жгла деньги в бесконечном цикле.
 */

/** Сколько неудач разрешено на один набор исходников, прежде чем сдаться. */
export const MAX_PREDICTION_ATTEMPTS = 5

/**
 * Общий потолок неудач на устойчивую сущность (ролик + сцена + модель).
 *
 * Бюджет `MAX_PREDICTION_ATTEMPTS` привязан к конкретным исходникам: сменил
 * оператор клип или переозвучил сцену — исходники другие, бюджет свежий. Это
 * правильно (типовое «no face detected» лечится именно перегенерацией клипа),
 * но само по себе снимает всякий потолок: двадцать перезапусков шага дают
 * двадцать оплаченных цепочек, потому что TTS каждый раз синтезируется заново
 * и хэш аудио каждый раз новый.
 *
 * Поэтому сверху висит второй, широкий счётчик — по сущности без отпечатков.
 * Три полных бюджета (три честные попытки оператора подобрать исходники) — это
 * потолок; дальше проблема не в исходниках, и жечь деньги дальше незачем.
 */
export const MAX_ENTITY_ATTEMPT_CEILING = 3 * MAX_PREDICTION_ATTEMPTS

/**
 * Сколько раз пробуем перенести готовый результат Replicate в своё хранилище.
 *
 * Ссылки replicate.delivery живут считаные часы. Если процесс лежал сутки и
 * вебхук потерян, перенос будет падать 404 при любом числе повторов: запись
 * навсегда остаётся succeeded без файла. После этого потолка она считается
 * мёртвой — её ключ надо освободить, иначе ролик заперт навсегда.
 */
export const MAX_PERSISTENCE_ATTEMPTS = 3

/**
 * Сколько ключей попыток разрешено просмотреть за один вызов.
 *
 * Отменённые оператором записи бюджет не тратят (см. consumesAttemptBudget),
 * поэтому сканирование ключей не ограничено бюджетом и нуждается в собственном
 * стопоре — иначе история из сотни отмен превратилась бы в сотню запросов к БД.
 */
export const MAX_ATTEMPT_KEY_SCAN = 50

export interface PredictionAttemptPlan {
  /** Идемпотентный ключ именно этой попытки. */
  key: string
  /** Номер попытки, начиная с 1. */
  attempt: number
  /** Последняя разрешённая попытка — дальше только осмысленная ошибка. */
  last: boolean
}

/**
 * Ключ попытки по её номеру. Первая попытка сохраняет исходный ключ —
 * иначе после выката все уже созданные записи стали бы «чужими».
 *
 * Возвращает null, когда попытки исчерпаны.
 */
export function planPredictionAttempt(
  baseKey: string,
  attempt: number,
  maxAttempts: number = MAX_PREDICTION_ATTEMPTS,
): PredictionAttemptPlan | null {
  if (!baseKey.trim()) {
    throw new Error("Базовый идемпотентный ключ не может быть пустым")
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`Номер попытки должен быть целым числом от 1, получено: ${attempt}`)
  }
  if (attempt > maxAttempts) return null

  return {
    key: attempt === 1 ? baseKey : `${baseKey}#retry-${attempt}`,
    attempt,
    last: attempt === maxAttempts,
  }
}

/**
 * Как понять, что ключ принадлежит области подсчёта бюджета.
 *
 * Отдельной колонки под область в схеме нет и завести её нельзя, поэтому
 * область — это префикс идемпотентного ключа, а принадлежность считается по
 * самому ключу. Уровни ключа разделены двоеточием, попытки внутри цепочки —
 * решёткой (`#retry-N`), так что «своими» для области S считаются ровно три
 * формы: сам S, всё что ниже уровнем (`S:`) и вся цепочка попыток (`S#`).
 *
 * Одно правило обслуживает оба уровня: и узкую область (набор исходников —
 * она же базовый ключ цепочки, потомки идут через `#`), и широкую (ролик +
 * сцена + модель — потомки идут через `:`). Голый `startsWith("S:")`, как было
 * раньше, для узкой области не годится: он не видит ни сам базовый ключ, ни
 * его ретраи, и счёт всегда выходил нулевым.
 */
export function attemptScopeKeyFilters(scope: string): Array<Record<string, string>> {
  const key = scope.trim()
  if (!key) throw new Error("Область подсчёта попыток не может быть пустой")
  return [{ equals: key }, { startsWith: `${key}:` }, { startsWith: `${key}#` }]
}

/** Почему ключ попытки отравлен — от этого зависит, тратится ли бюджет. */
export type PoisonedAttemptReason =
  /** Провайдер вернул терминальную ошибку. */
  | "failed"
  /** Отмену инициировал оператор. */
  | "canceled"
  /** Успех был, но результат утерян: перенос в хранилище исчерпал повторы. */
  | "lost"

export interface PredictionAttemptState {
  status: string
  persistedStorageKey: string | null
  persistenceStatus?: string | null
  persistenceAttemptCount?: number | null
}

/**
 * Почему от записи больше нечего ждать — или null, если ждать ещё можно.
 *
 * Главный сценарий здесь не failed, а «lost»: prediction завершился успешно,
 * но ссылка на результат протухла и перенос в хранилище провалился столько раз,
 * сколько разрешено. Такая запись выглядит успешной, файла не имеет и раньше
 * не считалась отравленной — новый ключ не открывался, и каждый перезапуск
 * снова падал на ней же.
 */
export function classifyPoisonedAttempt(
  prediction: PredictionAttemptState,
  maxPersistenceAttempts: number = MAX_PERSISTENCE_ATTEMPTS,
): PoisonedAttemptReason | null {
  if (prediction.persistedStorageKey) return null
  if (prediction.status === "failed") return "failed"
  if (prediction.status === "canceled") return "canceled"
  if (prediction.status !== "succeeded") return null

  // Перенос ещё не пробовали или он в процессе — результат может появиться.
  if (prediction.persistenceStatus !== "failed") return null
  return (prediction.persistenceAttemptCount ?? 0) >= maxPersistenceAttempts ? "lost" : null
}

/**
 * Запись «отравила» свой ключ: результата от неё уже не будет никогда.
 *
 * canceled сюда тоже попадает: отменённую попытку осмысленно перезапустить
 * новой, а не воскрешать старую запись.
 */
export function isPoisonedPredictionAttempt(
  prediction: PredictionAttemptState,
  maxPersistenceAttempts: number = MAX_PERSISTENCE_ATTEMPTS,
): boolean {
  return classifyPoisonedAttempt(prediction, maxPersistenceAttempts) !== null
}

/**
 * Тратит ли отравленная попытка бюджет повторов.
 *
 * Отмену инициирует оператор, а не провайдер: «передумал, не тот пресентер,
 * не та музыка» — это не признак негодных исходников. Если считать отмены,
 * пять передумов сжигают лимит, и следующий прогон молча уезжает в сборку
 * без lip-sync.
 */
export function consumesAttemptBudget(reason: PoisonedAttemptReason): boolean {
  return reason !== "canceled"
}

/**
 * Признаки устранимой (повторяемой) неудачи переноса результата в хранилище.
 *
 * Список намеренно закрытый: всё неопознанное считается неустранимым. Обратный
 * выбор (неизвестное = устранимое) вернул бы ровно тот дефект, ради которого
 * появился статус «lost»: запись «succeeded без файла» вечно держала бы свой
 * идемпотентный ключ, и ролик было бы не пересобрать никогда.
 */
const TRANSIENT_PERSISTENCE_PATTERNS: RegExp[] = [
  // HTTP: перегрузка и отказ шлюза/хранилища.
  /\b(?:429|500|502|503|504|507|509)\b/,
  // Коды сокетов Node: сеть до MinIO/S3 отвалилась.
  /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|ENETDOWN|EBUSY|EAGAIN)\b/i,
  /socket hang up|fetch failed|network error|connection (?:closed|reset|refused|error)/i,
  /\b(?:timed out|timeout)\b/i,
  // Коды ошибок S3/MinIO, которые сам протокол помечает как «повтори позже».
  /\b(?:SlowDown|RequestTimeout|RequestTimeTooSkewed|InternalError|ServiceUnavailable|OperationAborted)\b/i,
  /service unavailable|internal server error|bad gateway|gateway timeout|temporarily unavailable/i,
]

/**
 * Устранима ли ошибка переноса — то есть имеет ли смысл повторять её позже
 * тем же результатом Replicate.
 *
 * Зачем вообще: бюджет `MAX_PERSISTENCE_ATTEMPTS` делят три независимых
 * финализатора (вебхук, polling внутри waitForPrediction и recovery-плагин).
 * Двухминутная недоступность MinIO даёт три-четыре неудачи подряд, сжигает весь
 * бюджет за один сбой, и оплаченный результат объявляется потерянным, хотя файл
 * у провайдера ещё жив. Устранимые неудачи бюджет возвращают (см.
 * `markPersistenceFailed`), неустранимые — тратят.
 *
 * Разбираем не только message: у `fetch failed` вся диагностика лежит в cause,
 * а у ошибок Node — в полях code/errno.
 */
export function isTransientPersistenceFailure(error: unknown): boolean {
  const text = collectFailureText(error)
  if (!text.trim()) return false
  return TRANSIENT_PERSISTENCE_PATTERNS.some(pattern => pattern.test(text))
}

/** Плоский текст ошибки: message + code/errno/status + вложенная cause. */
function collectFailureText(error: unknown, depth = 0): string {
  if (error === null || error === undefined || depth > 3) return ""
  if (typeof error === "string") return error
  if (typeof error !== "object") return String(error)

  const record = error as Record<string, unknown>
  const parts: string[] = []
  for (const key of ["name", "message", "code", "errno", "status", "statusCode"]) {
    const value = record[key]
    if (typeof value === "string" || typeof value === "number") parts.push(String(value))
  }
  const nested = collectFailureText(record.cause, depth + 1)
  if (nested) parts.push(nested)
  return parts.join(" ")
}

/** Сообщение об исчерпании попыток: без исходной причины оно бесполезно. */
export function exhaustedAttemptsMessage(
  baseKey: string,
  maxAttempts: number,
  lastError: string | null,
): string {
  return `Replicate: исчерпан лимит повторов (${maxAttempts}) для ${baseKey}; ${describeLastError(lastError)}`
}

/**
 * Сообщение о широком потолке. Отделено от обычного исчерпания намеренно:
 * оператору нужно понять, что менять исходники дальше бесполезно — упёрлись не
 * в эти исходники, а в сцену целиком. Причины последней неудачи здесь нет и
 * быть не может: до чтения записей цепочки дело не доходит.
 */
export function exhaustedEntityAttemptsMessage(scope: string, maxAttempts: number): string {
  return `Replicate: исчерпан общий потолок попыток (${maxAttempts}) для сущности ${scope}; смена исходников больше не открывает бюджет`
}

function describeLastError(lastError: string | null): string {
  return lastError?.trim()
    ? `последняя ошибка: ${lastError.trim()}`
    : "последняя ошибка не сохранена"
}
