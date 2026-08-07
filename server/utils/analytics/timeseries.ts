/**
 * Динамика по дням.
 *
 * Просмотры за день — это прирост между замерами, а не сумма снимков:
 * `PostMetrics` хранит накопительное значение, и складывать снимки значит
 * считать одни и те же просмотры столько раз, сколько их успели померить.
 * Прирост берётся по последнему замеру дня и предыдущему замеру той же
 * публикации; первый замер целиком относится к своему дню — до него мы про
 * эту публикацию ничего не знали.
 *
 * Переходы и заявки — обычный счёт событий по дню, когда они произошли.
 */

import type { TimeseriesMetric, TimeseriesPoint, TimeseriesResult } from '~~/shared/types/analytics-funnel'
import { prisma } from '../prisma'
import type { AnalyticsScope } from './period'
import { periodToDto } from './period'
import { publicationFilterSql, uploadFilterSql } from './funnel'

/**
 * Меньше трёх непустых точек — не график, а три палки. Порог не семь, как в
 * макете: при окне «24 часа» семи дней не существует в принципе.
 */
const MIN_POINTS = 3

const DAY_MS = 86_400_000

function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Календарные дни окна в зоне сервера. */
function daysOf(scope: AnalyticsScope): string[] {
  const days: string[] = []
  const cursor = new Date(scope.from.getFullYear(), scope.from.getMonth(), scope.from.getDate())
  const last = new Date(scope.to.getFullYear(), scope.to.getMonth(), scope.to.getDate())
  while (cursor.getTime() <= last.getTime()) {
    days.push(dayKey(cursor))
    cursor.setTime(cursor.getTime() + DAY_MS)
  }
  return days
}

async function viewsByDay(scope: AnalyticsScope): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ day: Date; value: bigint }>>`
    WITH per_day AS (
      SELECT DISTINCT ON (pm."uploadId", date_trunc('day', pm."collectedAt"))
             pm."uploadId" AS upload_id,
             date_trunc('day', pm."collectedAt") AS day,
             pm.views AS views
      FROM "PostMetrics" pm
      JOIN "Upload" u ON u.id = pm."uploadId"
      JOIN "SocialAccount" sa ON sa.id = u."socialAccountId"
      WHERE u.status::text = 'published'
        AND pm."collectedAt" < ${scope.to}
        ${uploadFilterSql(scope)}
      ORDER BY pm."uploadId", 2, pm."collectedAt" DESC
    ),
    diffs AS (
      SELECT upload_id,
             day,
             GREATEST(views - COALESCE(LAG(views) OVER (PARTITION BY upload_id ORDER BY day), 0), 0) AS delta
      FROM per_day
    )
    SELECT day, SUM(delta)::bigint AS value
    FROM diffs
    WHERE day >= date_trunc('day', ${scope.from}::timestamp)
    GROUP BY day
    ORDER BY day
  `
  return new Map(rows.map(row => [dayKey(new Date(row.day)), Number(row.value)]))
}

async function eventsByDay(scope: AnalyticsScope, type: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ day: Date; value: bigint }>>`
    SELECT date_trunc('day', e."occurredAt") AS day, COUNT(*)::bigint AS value
    FROM "AttributionEvent" e
    JOIN "FactoryPublication" p ON p.id = e."publicationId"
    WHERE e.type = ${type}
      AND e."occurredAt" >= ${scope.from} AND e."occurredAt" < ${scope.to}
      ${publicationFilterSql(scope)}
    GROUP BY 1
    ORDER BY 1
  `
  return new Map(rows.map(row => [dayKey(new Date(row.day)), Number(row.value)]))
}

async function publicationsByDay(scope: AnalyticsScope): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ day: Date; value: bigint }>>`
    SELECT date_trunc('day', u."createdAt") AS day, COUNT(*)::bigint AS value
    FROM "Upload" u
    JOIN "SocialAccount" sa ON sa.id = u."socialAccountId"
    WHERE u.status::text = 'published'
      AND u."createdAt" >= ${scope.from} AND u."createdAt" < ${scope.to}
      ${uploadFilterSql(scope)}
    GROUP BY 1
    ORDER BY 1
  `
  return new Map(rows.map(row => [dayKey(new Date(row.day)), Number(row.value)]))
}

/** Расход на ролики, завершённые в этот день. Нужен только для стоимости заявки. */
async function videoCostByDay(scope: AnalyticsScope): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ day: Date; value: number | null }>>`
    SELECT date_trunc('day', v."finishedAt") AS day, SUM(v."totalCostActual") AS value
    FROM "Video" v
    LEFT JOIN "Scenario" s ON s.id = v."scenarioId"
    WHERE v."totalCostActual" IS NOT NULL
      AND v."finishedAt" >= ${scope.from} AND v."finishedAt" < ${scope.to}
      AND (${scope.appId}::int IS NULL OR s."appId" = ${scope.appId}::int)
      AND (${scope.pipelineId}::int IS NULL OR v."pipelineId" = ${scope.pipelineId}::int)
      AND (${scope.runId}::int IS NULL OR v."runId" = ${scope.runId}::int)
    GROUP BY 1
    ORDER BY 1
  `
  return new Map(rows.map(row => [dayKey(new Date(row.day)), Number(row.value ?? 0)]))
}

export async function computeTimeseries(
  scope: AnalyticsScope,
  metric: TimeseriesMetric,
): Promise<TimeseriesResult> {
  const days = daysOf(scope)
  const today = dayKey(new Date())

  const publications = await publicationsByDay(scope)

  let values: Map<string, number | null>
  if (metric === 'views') {
    values = new Map(await viewsByDay(scope))
  } else if (metric === 'clicks') {
    values = new Map(await eventsByDay(scope, 'messenger_opened'))
  } else if (metric === 'leads') {
    values = new Map(await eventsByDay(scope, 'conversion_submitted'))
  } else {
    const [leads, cost] = await Promise.all([
      eventsByDay(scope, 'conversion_submitted'),
      videoCostByDay(scope),
    ])
    // Ноль заявок и «стоимость заявки не считается» — разные вещи: делить не
    // на что, поэтому прочерк, а не нулевой столбик.
    values = new Map(days.map(day => {
      const dayLeads = leads.get(day) ?? 0
      const dayCost = cost.get(day) ?? 0
      return [day, dayLeads > 0 ? dayCost / dayLeads : null]
    }))
  }

  const points: TimeseriesPoint[] = days.map(day => ({
    day,
    value: values.has(day) ? values.get(day)! : (metric === 'costPerLead' ? null : 0),
    publications: publications.get(day) ?? 0,
    partial: day === today,
  }))

  const filled = points.filter(point => point.value !== null && point.value > 0).length

  return {
    metric,
    period: periodToDto(scope),
    points,
    enoughData: filled >= MIN_POINTS,
    minPoints: MIN_POINTS,
  }
}
