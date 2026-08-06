/**
 * Выборка запусков конвейеров для монитора.
 *
 * Один модуль на два endpoint'а: историю одного конвейера
 * (`/api/pipelines/:id/runs`) и общий экран по всем доступным
 * (`/api/pipelines/runs`). Разница между ними только в наборе конвейеров —
 * фильтры, сортировка, состав полей и мета одинаковые, и разъезжаться им
 * нельзя: это один и тот же список в двух местах интерфейса.
 *
 * Мета отдаёт разбивку по статусам, а не только общее число: заголовок дня в
 * макете читает «214 за сутки · 4 упало», и считать это по загруженным
 * страницам значит показывать неправду при любой пагинации.
 */

import type { RunStatus } from '~~/shared/types/workflow'
import { prisma } from './prisma'

export const RUN_STATUSES: RunStatus[] = [
  'pending',
  'running',
  'success',
  'failed',
  'cancelled',
  'no_data',
]

const RUN_STATUS_SET = new Set<string>(RUN_STATUSES)

export interface RunListQuery {
  page: number
  perPage: number
  /** Пусто — все статусы. */
  statuses: RunStatus[]
  /** Календарный день `YYYY-MM-DD` в зоне сервера. */
  day: string | null
  /** Один конвейер; для общего экрана — null. */
  pipelineId: number | null
}

export interface RunStatusCounts {
  total: number
  byStatus: Record<RunStatus, number>
}

/** Разбирает query-параметры запроса в фильтры. Мусор молча отбрасывается. */
export function parseRunListQuery(query: Record<string, unknown>): RunListQuery {
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(50, Math.max(1, Number(query.perPage) || 20))

  // status=failed или status=failed,cancelled — оба формата, потому что
  // фильтр в интерфейсе умеет и одиночный выбор, и «упавшие и остановленные».
  const raw = Array.isArray(query.status) ? query.status : [query.status]
  const statuses = raw
    .flatMap(value => (typeof value === 'string' ? value.split(',') : []))
    .map(value => value.trim())
    .filter(value => RUN_STATUS_SET.has(value)) as RunStatus[]

  const dayRaw = typeof query.day === 'string' ? query.day.trim() : ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayRaw) ? dayRaw : null

  const pipelineIdRaw = Number(query.pipelineId)
  const pipelineId = Number.isInteger(pipelineIdRaw) && pipelineIdRaw > 0 ? pipelineIdRaw : null

  return { page, perPage, statuses: [...new Set(statuses)], day, pipelineId }
}

/** Границы календарного дня в зоне сервера. */
function dayRange(day: string): { gte: Date; lt: Date } {
  const [year, month, date] = day.split('-').map(Number)
  const gte = new Date(year!, month! - 1, date!)
  const lt = new Date(year!, month! - 1, date! + 1)
  return { gte, lt }
}

/**
 * Собирает where для Prisma. `pipelineIds` — конвейеры, к которым у человека
 * есть доступ; null означает «ограничения нет» (администратор).
 */
export function buildRunListWhere(
  filters: RunListQuery,
  pipelineIds: number[] | null,
) {
  return {
    ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
    ...(pipelineIds ? { pipelineId: { in: pipelineIds } } : {}),
    ...(filters.statuses.length > 0 ? { status: { in: filters.statuses } } : {}),
    ...(filters.day ? { createdAt: dayRange(filters.day) } : {}),
  }
}

/**
 * Состав строки списка. Явный select, а не include: `graphSnapshot` и
 * `inputContext` — это по несколько килобайт на запуск, и тащить их в список
 * из двадцати строк незачем. Число блоков графа берётся отдельным дешёвым
 * запросом, см. `fetchSnapshotNodeCounts`.
 */
const RUN_SELECT = {
  id: true,
  pipelineId: true,
  status: true,
  triggerType: true,
  triggeredBy: true,
  replayOfRunId: true,
  retryOfRunId: true,
  parentRunId: true,
  cycleId: true,
  errorMessage: true,
  errorCategory: true,
  costActual: true,
  costEstimate: true,
  cancelRequestedAt: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  _count: { select: { steps: true } },
  pipeline: { select: { id: true, name: true, icon: true, color: true } },
} as const

/**
 * Кто запустил. `triggeredBy` хранит id, и без резолва в шапке вместо имени
 * стоял только способ запуска. Одним запросом на страницу, а не по строке.
 */
async function resolveTriggeredBy(userIds: number[]) {
  if (userIds.length === 0) return new Map<number, { id: number; name: string | null; surname: string | null; email: string }>()
  const users = await prisma.zavodUser.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, surname: true, email: true },
  })
  return new Map(users.map(user => [user.id, user]))
}

/** Число блоков в графе, снятом на момент запуска. Ноль — снимка нет. */
export function snapshotNodeCount(graphSnapshot: unknown): number {
  if (!graphSnapshot || typeof graphSnapshot !== 'object') return 0
  const nodes = (graphSnapshot as { nodes?: unknown }).nodes
  return Array.isArray(nodes) ? nodes.length : 0
}

/**
 * Число блоков в снимке графа — по запускам, без выгрузки самого снимка.
 * Считает Postgres: `jsonb_array_length` дешевле, чем гнать сотню килобайт
 * JSON в приложение ради одного числа на строку.
 *
 * Снимок берётся именно у запуска, а не у конвейера: граф с тех пор могли
 * перерисовать, и «шагов 8 из 12» по текущему графу было бы ложью.
 */
export async function fetchSnapshotNodeCounts(runIds: number[]): Promise<Map<number, number>> {
  if (runIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<Array<{ id: number; nodes: number | null }>>`
    SELECT "id",
           CASE
             WHEN jsonb_typeof("graphSnapshot" -> 'nodes') = 'array'
               THEN jsonb_array_length("graphSnapshot" -> 'nodes')
             ELSE NULL
           END AS "nodes"
    FROM "WorkflowRun"
    WHERE "id" = ANY(${runIds}::int[])
  `
  return new Map(rows.map(row => [row.id, row.nodes ?? 0]))
}

/**
 * Разбивка по статусам за тот же набор конвейеров и день, но БЕЗ фильтра по
 * статусу: иначе «4 упало» исчезало бы, как только включён отбор упавших.
 */
export async function countRunsByStatus(
  filters: RunListQuery,
  pipelineIds: number[] | null,
): Promise<RunStatusCounts> {
  const where = buildRunListWhere({ ...filters, statuses: [] }, pipelineIds)
  const rows = await prisma.workflowRun.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  })

  const byStatus = Object.fromEntries(RUN_STATUSES.map(s => [s, 0])) as Record<RunStatus, number>
  let total = 0
  for (const row of rows) {
    const count = row._count._all
    byStatus[row.status as RunStatus] = count
    total += count
  }
  return { total, byStatus }
}

/**
 * Шаг, который идёт прямо сейчас, — по одному на активный запуск.
 * Без него строка «в работе» показывает только имя конвейера, и человек не
 * понимает, ждать ему минуту или час.
 */
/** Шаг считается пройденным, если движок его закрыл — с любым исходом. */
const DONE_STEP_STATUSES = ['success', 'partial', 'no_data', 'skipped'] as const

/**
 * Сколько блоков пройдено. Именно пройдено, а не «есть строка шага»:
 * строки заводятся заранее (движок — при отмене уровня, сид — сразу целиком),
 * и `_count.steps` показывал бы «9 из 9» у запуска, который стоит на шестом.
 */
async function countDoneSteps(runIds: number[]): Promise<Map<number, number>> {
  if (runIds.length === 0) return new Map()
  const rows = await prisma.workflowStep.groupBy({
    by: ['runId'],
    where: { runId: { in: runIds }, status: { in: [...DONE_STEP_STATUSES] } },
    _count: { _all: true },
  })
  return new Map(rows.map(row => [row.runId, row._count._all]))
}

async function resolveCurrentSteps(runIds: number[]) {
  if (runIds.length === 0) return new Map<number, { nodeId: string; nodeName: string; nodeType: string }>()
  const steps = await prisma.workflowStep.findMany({
    where: { runId: { in: runIds }, status: 'running' },
    orderBy: { startedAt: 'desc' },
    select: { runId: true, nodeId: true, nodeName: true, nodeType: true },
  })
  const map = new Map<number, { nodeId: string; nodeName: string; nodeType: string }>()
  for (const step of steps) {
    if (!map.has(step.runId)) map.set(step.runId, step)
  }
  return map
}

/** Страница запусков с конвейером, числом шагов, стоимостью и автором запуска. */
export async function listRuns(filters: RunListQuery, pipelineIds: number[] | null) {
  const where = buildRunListWhere(filters, pipelineIds)

  const [runs, counts] = await Promise.all([
    prisma.workflowRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.perPage,
      take: filters.perPage,
      select: RUN_SELECT,
    }),
    countRunsByStatus(filters, pipelineIds),
  ])

  const filteredTotal = filters.statuses.length > 0
    ? filters.statuses.reduce((sum, status) => sum + counts.byStatus[status], 0)
    : counts.total

  const runIds = runs.map(run => run.id)
  const [byId, nodeCounts, currentSteps, doneSteps] = await Promise.all([
    resolveTriggeredBy(
      [...new Set(runs.map(run => run.triggeredBy).filter((id): id is number => id != null))],
    ),
    fetchSnapshotNodeCounts(runIds),
    resolveCurrentSteps(runs.filter(run => run.status === 'running').map(run => run.id)),
    countDoneSteps(runIds),
  ])

  const data = runs.map(run => ({
    ...run,
    triggeredByUser: run.triggeredBy != null ? byId.get(run.triggeredBy) ?? null : null,
    totalNodes: nodeCounts.get(run.id) ?? 0,
    doneSteps: doneSteps.get(run.id) ?? 0,
    currentStep: currentSteps.get(run.id) ?? null,
  }))

  return {
    data,
    meta: {
      total: filteredTotal,
      page: filters.page,
      perPage: filters.perPage,
      totalPages: Math.max(1, Math.ceil(filteredTotal / filters.perPage)),
      /** Разбивка по всем статусам за тот же период — не зависит от фильтра. */
      statusCounts: counts.byStatus,
      statusTotal: counts.total,
    },
  }
}
