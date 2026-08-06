/**
 * Сводка «что требует внимания».
 *
 * Один источник для двух мест: счётчиков у пунктов сайдбара и блока
 * «Требует внимания» на дашборде. Раздёргивать шесть списков поллингом раз в
 * 5 секунд ради тех же цифр дороже, чем посчитать их одним запросом.
 */
export interface DashboardCounters {
  /** Запуски конвейеров прямо сейчас. */
  activeRuns: number
  /** Всего трендов — счётчик объёма, а не проблемы. */
  trends: number
  /** Сценарии, ждущие решения человека. */
  scenariosOnReview: number
  /** Видео, упавшие на генерации: их можно повторить. */
  videosFailed: number
  /** Публикации в очереди и на повторе. */
  postingQueued: number
  /** Аккаунты с истёкшим или отозванным токеном. */
  accountsAttention: number
}

/** Строка очереди решений оператора. Отсортированы по возрасту, не по типу. */
export interface AttentionRow {
  key: keyof DashboardCounters | string
  /** Куда ведёт разбор этой причины. */
  to: string
  label: string
  count: number
  /** Возраст самого старого объекта в миллисекундах. */
  oldestAgeMs: number | null
  severity: 'warning' | 'danger'
}

/**
 * Расход за сутки в строке состояния дашборда.
 *
 * Приходит только администратору: суммы по заводу живут за тем же правом, что
 * и балансы. Остальные не увидят плитку вовсе — счётчик не должен подсказывать
 * объём того, чего человек не видит.
 */
export interface DashboardSpend {
  /** USD за последние сутки. */
  totalUsd: number
  /** Стоимость ролика. null, когда за сутки ни один не завершился. */
  perVideoUsd: number | null
  videoCount: number
}

export interface DashboardSummary {
  counters: DashboardCounters
  attention: AttentionRow[]
  /** Момент расчёта — для индикатора обновления в топбаре. */
  computedAt: string
  /** Расход за сутки. null — у пользователя нет права на суммы. */
  spend: DashboardSpend | null
}
