/**
 * Простой парсер cron-выражений (5 полей: минута, час, день, месяц, день недели).
 * Вычисляет следующее время запуска от заданной базовой даты.
 */

interface CronFields {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
}

function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set()

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    const step = stepMatch ? Number(stepMatch[2]) : 1
    const range = stepMatch ? stepMatch[1] : part

    if (range === '*') {
      for (let i = min; i <= max; i += step) values.add(i)
      continue
    }

    const rangeMatch = range!.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1]!)
      const end = Number(rangeMatch[2]!)
      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) values.add(i)
      }
      continue
    }

    const num = Number(range)
    if (!Number.isNaN(num) && num >= min && num <= max) {
      values.add(num)
    }
  }

  return [...values].sort((a, b) => a - b)
}

function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Невалидное cron-выражение: ожидается 5 полей, получено ${parts.length}`)
  }

  return {
    minutes: parseField(parts[0]!, 0, 59),
    hours: parseField(parts[1]!, 0, 23),
    daysOfMonth: parseField(parts[2]!, 1, 31),
    months: parseField(parts[3]!, 1, 12),
    daysOfWeek: parseField(parts[4]!, 0, 6),
  }
}

/** Вычисляет следующее время запуска после base. Максимум год вперёд. */
export function getNextRunTime(cronExpr: string, base: Date = new Date()): Date {
  const fields = parseCron(cronExpr)
  const maxIterations = 525960 // ~1 год в минутах
  const candidate = new Date(base.getTime())

  // Сдвигаемся на следующую минуту
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getMonth() + 1
    if (!fields.months.includes(month)) {
      candidate.setMonth(candidate.getMonth() + 1, 1)
      candidate.setHours(0, 0, 0, 0)
      continue
    }

    const dom = candidate.getDate()
    const dow = candidate.getDay()
    if (!fields.daysOfMonth.includes(dom) || !fields.daysOfWeek.includes(dow)) {
      candidate.setDate(candidate.getDate() + 1)
      candidate.setHours(0, 0, 0, 0)
      continue
    }

    const hour = candidate.getHours()
    if (!fields.hours.includes(hour)) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0)
      continue
    }

    const minute = candidate.getMinutes()
    if (!fields.minutes.includes(minute)) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0)
      continue
    }

    return new Date(candidate.getTime())
  }

  throw new Error('Не удалось вычислить следующее время запуска (превышен лимит итераций)')
}

/** Проверяет валидность cron-выражения. */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr)
    return true
  } catch {
    return false
  }
}
