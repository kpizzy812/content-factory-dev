/**
 * Стоимость шага и запуска конвейера.
 *
 * Контракт с исполнителями: тот, кто знает сумму, кладёт её в output ноды
 * двумя служебными ключами — `_costActualUsd` и `_costEstimateUsd`. Движок их
 * снимает и пишет в WorkflowStep, а агрегат запуска пересчитывает из строк
 * шагов. Ключи служебные, как `_noData` и `_domainDegraded`: downstream-логика
 * их не читает, они нужны монитору и балансам.
 *
 * Почему агрегат считается из БД, а не копится в памяти: запуск переживает
 * рестарт и resume (pipeline-engine подхватывает уже выполненные шаги), а
 * `recalcRunCost` идемпотентен — сколько раз ни позови, результат один.
 *
 * Валюта — USD, как и в остальном учёте: `ServiceBalanceEntry.currency`,
 * `AiAuditLog.costUsd`, `Video.totalCostActual`.
 */

import { prisma } from './prisma'

export interface StepCost {
  actual: number | null
  estimate: number | null
}

const EMPTY: StepCost = { actual: null, estimate: null }

/** Служебные ключи, которыми исполнитель сообщает сумму. */
export const COST_ACTUAL_KEY = '_costActualUsd'
export const COST_ESTIMATE_KEY = '_costEstimateUsd'

/** Приводит произвольное значение к неотрицательному числу или null. */
function toAmount(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  return n
}

/**
 * Суммирует стоимость по массиву объектов с денежными полями.
 * Возвращает null, если ни у одного объекта суммы нет — ноль и «не знаем»
 * это разные вещи: ноль означает «шаг бесплатный» (локальный рендер),
 * null — «сумму никто не посчитал».
 */
export function sumAmounts(
  items: ReadonlyArray<Record<string, unknown>> | undefined,
  field: string,
): number | null {
  if (!Array.isArray(items) || items.length === 0) return null
  let total = 0
  let known = false
  for (const item of items) {
    const amount = toAmount(item?.[field])
    if (amount === null) continue
    total += amount
    known = true
  }
  return known ? total : null
}

/**
 * Типы блоков, которые заведомо ничего не стоят: логика графа и локальные
 * операции без внешних вызовов. У них честный ноль, а не «неизвестно» — иначе
 * в мониторе половина шагов стоит с прочерком и человек не понимает, где
 * сумма не посчитана, а где её просто нет.
 *
 * `code` и `http_request` сюда не входят: они ходят наружу, и во что это
 * обходится, знает только автор конвейера.
 */
const FREE_NODE_TYPES = new Set([
  'filter',
  'set',
  'if_switch',
  'loop',
  'wait',
  'note',
  'notification',
])

/**
 * Снимает стоимость шага: сначала служебные ключи output, затем таблица
 * заведомо бесплатных типов блоков.
 */
export function readStepCost(nodeType: string, output: unknown): StepCost {
  const rec = output && typeof output === 'object' && !Array.isArray(output)
    ? output as Record<string, unknown>
    : null

  const actual = rec ? toAmount(rec[COST_ACTUAL_KEY]) : null
  const estimate = rec ? toAmount(rec[COST_ESTIMATE_KEY]) : null

  if (actual === null && FREE_NODE_TYPES.has(nodeType)) {
    return { actual: 0, estimate }
  }

  return { actual, estimate }
}

/**
 * Пересчитывает агрегат запуска из его шагов и пишет в WorkflowRun.
 * Возвращает записанные суммы.
 *
 * Ошибки БД не пробрасывает: стоимость — это отчётность, из-за неё запуск
 * падать не должен.
 */
export async function recalcRunCost(runId: number): Promise<StepCost> {
  try {
    const agg = await prisma.workflowStep.aggregate({
      where: { runId },
      _sum: { costActual: true, costEstimate: true },
      _count: { costActual: true, costEstimate: true },
    })

    const actual = agg._count.costActual > 0 ? Number(agg._sum.costActual ?? 0) : null
    const estimate = agg._count.costEstimate > 0 ? Number(agg._sum.costEstimate ?? 0) : null

    await prisma.workflowRun.update({
      where: { id: runId },
      data: { costActual: actual, costEstimate: estimate },
    })

    return { actual, estimate }
  } catch (err) {
    console.warn(
      `[pipeline-cost] recalcRunCost failed (run=${runId}): ${err instanceof Error ? err.message : String(err)}`,
    )
    return EMPTY
  }
}
