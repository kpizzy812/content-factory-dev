/**
 * Уровни серьёзности проверок quality gate и сборка агрегированного вердикта.
 *
 * ПОЧЕМУ отдельным модулем: до этого у чека был только булев флаг `blocking`,
 * который никто никогда не выставлял в false. Из-за этого косметическое
 * замечание (короткий хук) валило партию ровно так же, как медицинское обещание
 * «избавит от диабета». П.10 docs/PROJECT_CONTEXT.md требует УПРАВЛЯЕМЫХ quality
 * gates, а не одного рубильника, поэтому классификация уровней и сборка вердикта
 * вынесены в чистые функции — их можно проверить тестом без БД и без сети.
 */

/**
 * blocking — нарушение, из-за которого публиковать нельзя (регуляторный риск,
 *            сломанный артефакт, непроверенное качество).
 * warning  — замечание, которое стоит показать оператору, но которое не должно
 *            останавливать партию.
 */
export type QualityCheckSeverity = 'blocking' | 'warning'

export type QualityVerdict = 'pass' | 'warning' | 'fail'

export interface QualityCheck {
  key: string
  passed: boolean
  severity: QualityCheckSeverity
  /**
   * Историческое поле: остаётся ради уже сохранённых в БД `FactoryQualityReview.checks`
   * и потребителей, которые читают его напрямую. Всегда равно `severity === 'blocking'`.
   */
  blocking: boolean
  message: string
  value?: unknown
}

export interface QualityAggregate {
  verdict: QualityVerdict
  score: number
  blockingFailed: QualityCheck[]
  warningFailed: QualityCheck[]
  issues: string[]
}

/**
 * Собирает чек, синхронизируя `blocking` с `severity`, чтобы эти два поля
 * физически не могли разъехаться.
 */
export function makeQualityCheck(
  key: string,
  passed: boolean,
  message: string,
  options: { severity?: QualityCheckSeverity; value?: unknown } = {},
): QualityCheck {
  const severity = options.severity ?? 'blocking'
  return {
    key,
    passed,
    severity,
    blocking: severity === 'blocking',
    message,
    value: options.value,
  }
}

/**
 * Агрегированный вердикт: один упавший блокирующий чек даёт `fail`, только
 * предупреждения — `warning`, всё зелёное — `pass`.
 *
 * Пустой список чеков намеренно даёт `fail`, а не `pass`: «мы ничего не
 * проверили» не должно выглядеть как «всё хорошо».
 */
export function aggregateQualityVerdict(checks: QualityCheck[]): QualityAggregate {
  const blockingFailed = checks.filter(check => check.severity === 'blocking' && !check.passed)
  const warningFailed = checks.filter(check => check.severity === 'warning' && !check.passed)
  const passed = checks.filter(check => check.passed).length
  const score = checks.length > 0 ? Math.round((passed / checks.length) * 100) : 0
  const verdict: QualityVerdict = checks.length === 0
    ? 'fail'
    : blockingFailed.length > 0
      ? 'fail'
      : warningFailed.length > 0
        ? 'warning'
        : 'pass'
  return {
    verdict,
    score,
    blockingFailed,
    warningFailed,
    issues: checks
      .filter(check => !check.passed)
      .map(check => `${check.key}: ${check.message}`),
  }
}
