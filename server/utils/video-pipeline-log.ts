/**
 * Форма и обрезка step-логов пайплайна видео.
 *
 * Логи шага живут в одной jsonb-колонке `VideoGenerationStep.logs`, поэтому
 * дописывание делается атомарным UPDATE-ом (см. appendStepLog). Здесь — только
 * чистая часть: как выглядит запись и сколько записей мы храним. Это нужно
 * второй раз в fallback-ветке (если raw-запрос не прошёл) и в тестах, чтобы
 * форма записей в обеих ветках гарантированно совпадала.
 */

/**
 * Сколько последних записей держим у шага.
 * Логов у клипов много (по записи на сцену и на каждый статус fal-очереди),
 * а колонка одна: без потолка jsonb пухнет и каждое чтение шага тащит мегабайты.
 */
export const STEP_LOG_LIMIT = 500

export interface StepLogEntry {
  ts: string
  msg: string
}

/** Одна запись лога. Время в ISO — так его пишет UI и старые записи. */
export function buildStepLogEntry(message: string, now: Date = new Date()): StepLogEntry {
  return { ts: now.toISOString(), msg: message }
}

/**
 * Приводит сохранённое значение колонки к массиву записей.
 * Мусор (null, объект, строка) считаем пустым логом: терять новую запись
 * из-за исторического хлама в колонке смысла нет.
 */
export function normalizeStepLogs(current: unknown): StepLogEntry[] {
  if (!Array.isArray(current)) return []
  return current.filter(
    (entry): entry is StepLogEntry =>
      !!entry && typeof entry === "object"
      && typeof (entry as StepLogEntry).ts === "string"
      && typeof (entry as StepLogEntry).msg === "string",
  )
}

/**
 * Дописывает запись и оставляет только последние `limit` штук.
 * Хвост важнее головы: отладка идёт от последней ошибки назад.
 */
export function appendAndTrimStepLogs(
  current: unknown,
  entry: StepLogEntry,
  limit: number = STEP_LOG_LIMIT,
): StepLogEntry[] {
  const next = [...normalizeStepLogs(current), entry]
  if (limit <= 0) return []
  return next.length > limit ? next.slice(next.length - limit) : next
}
