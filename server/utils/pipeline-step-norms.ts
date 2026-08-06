/**
 * Норма длительности шага по типу блока.
 *
 * Диаграмма длительностей в макете красит шаг, который «дольше нормы в 3+
 * раза». Нормы не существовало, и порог считался от самого запуска: больше
 * половины его времени — предупреждение. Это неверно для конвейера из двух
 * блоков и бесполезно для конвейера из двадцати.
 *
 * Норма — медиана длительности успешных шагов этого типа за окно. Медиана, а
 * не среднее: один зависший шаг на сорок минут сдвигает среднее так, что
 * «дольше нормы» перестаёт срабатывать вообще.
 *
 * Тип блока, у которого меньше `MIN_SAMPLES` наблюдений, нормы не получает:
 * по двум замерам норму не строят, а отсутствие нормы интерфейс переживает —
 * он просто не красит шаг.
 */

import { prisma } from './prisma'

/** Меньше этого числа наблюдений — норму не считаем. */
const MIN_SAMPLES = 5

const DAY_MS = 86_400_000

export interface StepDurationNorm {
  nodeType: string
  /** Медиана длительности успешных шагов, мс. */
  medianMs: number
  samples: number
}

export interface StepDurationNorms {
  windowDays: number
  /** Во сколько раз дольше нормы шаг считается подозрительным. */
  slowFactor: number
  norms: StepDurationNorm[]
}

/** Порог из макета: «дольше нормы в 3+ раза». */
export const SLOW_FACTOR = 3

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!
}

/**
 * Считает нормы по завершённым успешно шагам за окно.
 *
 * @param windowDays окно наблюдений, по умолчанию 14 дней
 */
export async function computeStepDurationNorms(windowDays = 14): Promise<StepDurationNorms> {
  const days = Math.min(180, Math.max(1, Math.round(windowDays)))
  const since = new Date(Date.now() - days * DAY_MS)

  const rows = await prisma.workflowStep.findMany({
    where: {
      status: { in: ['success', 'partial'] },
      duration: { not: null, gt: 0 },
      finishedAt: { gte: since },
    },
    select: { nodeType: true, duration: true },
  })

  const byType = new Map<string, number[]>()
  for (const row of rows) {
    if (row.duration == null) continue
    const list = byType.get(row.nodeType)
    if (list) list.push(row.duration)
    else byType.set(row.nodeType, [row.duration])
  }

  const norms: StepDurationNorm[] = []
  for (const [nodeType, values] of byType) {
    if (values.length < MIN_SAMPLES) continue
    norms.push({ nodeType, medianMs: median(values), samples: values.length })
  }
  norms.sort((a, b) => b.medianMs - a.medianMs)

  return { windowDays: days, slowFactor: SLOW_FACTOR, norms }
}
