/**
 * Реестр фоновых задач: кто запущен, когда был последний тик, что упало.
 *
 * До него «здоровье системы» в админке показывало только очередь запусков —
 * а самая частая авария завода выглядит иначе: планировщик тихо перестал
 * тикать, и очередь просто не разбирается. Без отметки последнего тика это
 * видно только по тому, что «ничего не происходит».
 *
 * Состояние в памяти процесса — как и `getRuntimeStats`: приложение живёт в
 * одном экземпляре (`single_instance_hardened`), и хранить тики в базе значит
 * писать в неё раз в тридцать секунд ради строки в интерфейсе.
 */

export interface SchedulerEntry {
  key: string
  label: string
  intervalMs: number
  /** Момент регистрации — тика ещё могло не быть. */
  startedAt: string
  lastTickAt: string | null
  lastOkAt: string | null
  lastError: string | null
  tickCount: number
  errorCount: number
}

const registry = new Map<string, SchedulerEntry>()

/** Регистрирует задачу при старте. Повторный вызов перетирает — рестарт плагина. */
export function registerScheduler(key: string, label: string, intervalMs: number): void {
  registry.set(key, {
    key,
    label,
    intervalMs,
    startedAt: new Date().toISOString(),
    lastTickAt: null,
    lastOkAt: null,
    lastError: null,
    tickCount: 0,
    errorCount: 0,
  })
}

/**
 * Отмечает тик. Ошибка не отменяет тик: задача жива, но её работа не удалась —
 * это разные аварии, и в интерфейсе они выглядят по-разному.
 */
export function markSchedulerTick(key: string, error?: unknown): void {
  const entry = registry.get(key)
  if (!entry) return
  const now = new Date().toISOString()
  entry.lastTickAt = now
  entry.tickCount += 1
  if (error) {
    entry.errorCount += 1
    entry.lastError = error instanceof Error ? error.message : String(error)
  }
  else {
    entry.lastOkAt = now
    entry.lastError = null
  }
}

/**
 * `setInterval` с отметкой тика.
 *
 * Обёртка, а не ручные вызовы в каждом теле: тело задачи и так завёрнуто в
 * try/catch с записью в журнал агента, и добавлять туда ещё по две строки
 * значит однажды забыть.
 */
export function trackedInterval(
  key: string,
  label: string,
  intervalMs: number,
  tick: () => unknown | Promise<unknown>,
): ReturnType<typeof setInterval> {
  registerScheduler(key, label, intervalMs)
  return setInterval(async () => {
    try {
      await tick()
      markSchedulerTick(key)
    }
    catch (err) {
      markSchedulerTick(key, err)
    }
  }, intervalMs)
}

/**
 * Задача считается просроченной, если тика не было дольше двух интервалов.
 * Один пропущенный интервал — это нормальный дрейф таймера под нагрузкой.
 */
const OVERDUE_FACTOR = 2

export interface SchedulerStatus extends SchedulerEntry {
  overdue: boolean
  /** Сколько прошло с последнего тика, мс. null — тика ещё не было. */
  sinceLastTickMs: number | null
}

export function getSchedulerStats(): {
  enabled: boolean
  total: number
  overdue: number
  failing: number
  schedulers: SchedulerStatus[]
} {
  const now = Date.now()
  const schedulers = [...registry.values()].map((entry) => {
    const reference = entry.lastTickAt ?? entry.startedAt
    const sinceMs = now - new Date(reference).getTime()
    return {
      ...entry,
      sinceLastTickMs: entry.lastTickAt ? now - new Date(entry.lastTickAt).getTime() : null,
      overdue: sinceMs > entry.intervalMs * OVERDUE_FACTOR,
    }
  })
  schedulers.sort((a, b) => a.label.localeCompare(b.label, 'ru'))

  return {
    // Планировщики глушатся целиком в тестах и в некоторых окружениях.
    enabled: process.env.SCHEDULERS_ENABLED !== 'false',
    total: schedulers.length,
    overdue: schedulers.filter(s => s.overdue).length,
    failing: schedulers.filter(s => s.lastError != null).length,
    schedulers,
  }
}
