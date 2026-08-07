/**
 * Воронка производства и продаж.
 *
 * Восемь стадий склеены из двух источников. Тренды, сценарии, ролики и
 * публикации — наши таблицы; переходы, заявки и продажи — события атрибуции
 * по tracking token, которые присылают мессенджер и conversion sink.
 *
 * Просмотры берутся из последнего замера каждой публикации, а не из суммы
 * всех замеров: `PostMetrics` — это снимки одной и той же публикации, и
 * складывать их значит считать одни просмотры по нескольку раз.
 *
 * Нормы CTR у нас нет и взять её неоткуда, поэтому провал определяется
 * сравнением с прошлым окном той же длины, а не выдуманным порогом.
 */

import { Prisma } from '../../../app/generated/prisma/client'
import type {
  AnalyticsKpi,
  FunnelResult,
  FunnelStage,
  FunnelStageKey,
  FunnelUnitGroup,
} from '~~/shared/types/analytics-funnel'
import { prisma } from '../prisma'
import type { AnalyticsScope } from './period'
import { hasPublicationOnlyFilters, periodToDto, previousScope } from './period'

/** Насколько CTR должен просесть к прошлому окну, чтобы это считалось провалом. */
const CTR_ALERT_DROP = 0.8

interface FunnelNumbers {
  trends: number
  scenarios: number
  videos: number
  publications: number
  views: number
  clicks: number
  leads: number
  sales: number
  /** Расход на ролики, завершённые за окно. USD. */
  videoCostUsd: number
  /** Роликов с посчитанной стоимостью — делить на них. */
  costedVideos: number
}

/**
 * Условия отбора публикаций. Один фрагмент на все запросы: у воронки,
 * рейтингов и динамики отбор обязан быть одинаковым.
 */
export function uploadFilterSql(scope: AnalyticsScope) {
  return Prisma.sql`
    AND (${scope.appId}::int IS NULL OR sa."appId" = ${scope.appId}::int)
    AND (${scope.platform}::text IS NULL OR sa."platform"::text = ${scope.platform}::text)
    AND (${scope.socialAccountId}::int IS NULL OR u."socialAccountId" = ${scope.socialAccountId}::int)
    AND (${scope.pipelineId}::int IS NULL OR u."pipelineId" = ${scope.pipelineId}::int)
    AND (${scope.runId}::int IS NULL OR u."runId" = ${scope.runId}::int)
  `
}

/** То же самое, но для событий атрибуции: они висят на фабричной публикации. */
export function publicationFilterSql(scope: AnalyticsScope) {
  return Prisma.sql`
    AND (${scope.appId}::int IS NULL OR p."appId" = ${scope.appId}::int)
    AND (${scope.platform}::text IS NULL OR p."platform"::text = ${scope.platform}::text)
    AND (${scope.socialAccountId}::int IS NULL OR p."socialAccountId" = ${scope.socialAccountId}::int)
    AND (${scope.runId}::int IS NULL OR p."runId" = ${scope.runId}::int)
    AND (${scope.pipelineId}::int IS NULL OR EXISTS (
      SELECT 1 FROM "WorkflowRun" wr
      WHERE wr.id = p."runId" AND wr."pipelineId" = ${scope.pipelineId}::int
    ))
  `
}

/** Просмотры по последнему замеру каждой публикации окна. */
async function sumLatestViews(scope: AnalyticsScope): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ views: bigint | null }>>`
    SELECT COALESCE(SUM(m.views), 0)::bigint AS views
    FROM (
      SELECT DISTINCT ON (pm."uploadId") pm."uploadId", pm.views
      FROM "PostMetrics" pm
      JOIN "Upload" u ON u.id = pm."uploadId"
      JOIN "SocialAccount" sa ON sa.id = u."socialAccountId"
      WHERE u.status::text = 'published'
        AND u."createdAt" >= ${scope.from} AND u."createdAt" < ${scope.to}
        ${uploadFilterSql(scope)}
      ORDER BY pm."uploadId", pm."collectedAt" DESC
    ) m
  `
  return Number(rows[0]?.views ?? 0)
}

/** Публикаций за окно. */
async function countPublications(scope: AnalyticsScope): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "Upload" u
    JOIN "SocialAccount" sa ON sa.id = u."socialAccountId"
    WHERE u.status::text = 'published'
      AND u."createdAt" >= ${scope.from} AND u."createdAt" < ${scope.to}
      ${uploadFilterSql(scope)}
  `
  return Number(rows[0]?.count ?? 0)
}

/** События атрибуции за окно, разложенные по типу. */
export async function countAttributionEvents(scope: AnalyticsScope): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
    SELECT e.type, COUNT(*)::bigint AS count
    FROM "AttributionEvent" e
    JOIN "FactoryPublication" p ON p.id = e."publicationId"
    WHERE e."occurredAt" >= ${scope.from} AND e."occurredAt" < ${scope.to}
      ${publicationFilterSql(scope)}
    GROUP BY e.type
  `
  return new Map(rows.map(row => [row.type, Number(row.count)]))
}

/**
 * Расход на ролики окна. Берётся факт `Video.totalCostActual` — тот же
 * агрегат, что показывают карточка ролика и список: считать деньги здесь
 * заново по журналу списаний значило бы завести вторую правду.
 */
async function videoCost(scope: AnalyticsScope): Promise<{ costUsd: number; count: number }> {
  const result = await prisma.video.aggregate({
    where: {
      totalCostActual: { not: null },
      finishedAt: { gte: scope.from, lt: scope.to },
      ...(scope.appId ? { scenario: { appId: scope.appId } } : {}),
      ...(scope.pipelineId ? { pipelineId: scope.pipelineId } : {}),
      ...(scope.runId ? { runId: scope.runId } : {}),
    },
    _sum: { totalCostActual: true },
    _count: { _all: true },
  })
  return {
    costUsd: Number(result._sum.totalCostActual ?? 0),
    count: result._count._all,
  }
}

async function collectNumbers(scope: AnalyticsScope): Promise<FunnelNumbers> {
  const productionWindow = { gte: scope.from, lt: scope.to }

  const [trends, scenarios, videos, publications, views, events, cost] = await Promise.all([
    prisma.trend.count({
      where: {
        importedAt: productionWindow,
        isDeleted: false,
        ...(scope.appId ? { appId: scope.appId } : {}),
        ...(scope.pipelineId ? { pipelineId: scope.pipelineId } : {}),
        ...(scope.runId ? { runId: scope.runId } : {}),
      },
    }),
    prisma.scenario.count({
      where: {
        createdAt: productionWindow,
        isDeleted: false,
        ...(scope.appId ? { appId: scope.appId } : {}),
        ...(scope.pipelineId ? { pipelineId: scope.pipelineId } : {}),
        ...(scope.runId ? { runId: scope.runId } : {}),
      },
    }),
    prisma.video.count({
      where: {
        createdAt: productionWindow,
        ...(scope.appId ? { scenario: { appId: scope.appId } } : {}),
        ...(scope.pipelineId ? { pipelineId: scope.pipelineId } : {}),
        ...(scope.runId ? { runId: scope.runId } : {}),
      },
    }),
    countPublications(scope),
    sumLatestViews(scope),
    countAttributionEvents(scope),
    videoCost(scope),
  ])

  return {
    trends,
    scenarios,
    videos,
    publications,
    views,
    clicks: events.get('messenger_opened') ?? 0,
    leads: events.get('conversion_submitted') ?? 0,
    sales: events.get('sale_attributed') ?? 0,
    videoCostUsd: cost.costUsd,
    costedVideos: cost.count,
  }
}

function ratio(value: number, base: number): number | null {
  return base > 0 ? value / base : null
}

const STAGE_HREF: Partial<Record<FunnelStageKey, string>> = {
  trends: '/trends',
  scenarios: '/scenarios',
  videos: '/videos',
  publications: '/uploads',
}

export async function computeFunnel(scope: AnalyticsScope): Promise<FunnelResult> {
  const [current, previous] = await Promise.all([
    collectNumbers(scope),
    collectNumbers(previousScope(scope)),
  ])

  const ctr = ratio(current.clicks, current.views)
  const previousCtr = ratio(previous.clicks, previous.views)
  const ctrDropped = ctr !== null && previousCtr !== null && previousCtr > 0 && ctr < previousCtr * CTR_ALERT_DROP

  const raw: Array<Omit<FunnelStage, 'share' | 'href' | 'unitGroup'> & { unitGroup: FunnelUnitGroup }> = [
    {
      key: 'trends',
      unitGroup: 'items',
      label: 'Тренды',
      value: current.trends,
      scope: 'production',
      ratio: null,
      ratioOf: null,
      ratioKind: null,
      alert: false,
    },
    {
      key: 'scenarios',
      unitGroup: 'items',
      label: 'Сценарии',
      value: current.scenarios,
      scope: 'production',
      ratio: ratio(current.scenarios, current.trends),
      ratioOf: 'trends',
      ratioKind: 'share',
      alert: false,
    },
    {
      key: 'videos',
      unitGroup: 'items',
      label: 'Ролики',
      value: current.videos,
      scope: 'production',
      ratio: ratio(current.videos, current.scenarios),
      ratioOf: 'scenarios',
      ratioKind: 'multiplier',
      alert: false,
    },
    {
      key: 'publications',
      unitGroup: 'items',
      label: 'Публикации',
      value: current.publications,
      scope: 'publication',
      ratio: ratio(current.publications, current.videos),
      ratioOf: 'videos',
      ratioKind: 'share',
      alert: false,
    },
    {
      key: 'views',
      unitGroup: 'views',
      label: 'Просмотры',
      value: current.views,
      scope: 'publication',
      ratio: ratio(current.views, current.publications),
      ratioOf: 'publications',
      ratioKind: 'per',
      alert: false,
    },
    {
      key: 'clicks',
      unitGroup: 'events',
      label: 'Переходы',
      value: current.clicks,
      scope: 'attribution',
      ratio: ctr,
      ratioOf: 'views',
      ratioKind: 'share',
      alert: ctrDropped,
    },
    {
      key: 'leads',
      unitGroup: 'events',
      label: 'Заявки',
      value: current.leads,
      scope: 'attribution',
      ratio: ratio(current.leads, current.clicks),
      ratioOf: 'clicks',
      ratioKind: 'share',
      alert: false,
    },
    {
      key: 'sales',
      unitGroup: 'events',
      label: 'Продажи',
      value: current.sales,
      scope: 'attribution',
      ratio: ratio(current.sales, current.leads),
      ratioOf: 'leads',
      ratioKind: 'share',
      alert: false,
    },
  ]

  // Столбик сравнивает стадию с крупнейшей стадией той же величины. Общая
  // шкала здесь невозможна: восемьсот тысяч просмотров рядом с сорока
  // роликами превращают все остальные стадии в невидимую полоску, и воронка
  // перестаёт что-либо показывать.
  const peaks = new Map<FunnelUnitGroup, number>()
  for (const stage of raw) {
    peaks.set(stage.unitGroup, Math.max(peaks.get(stage.unitGroup) ?? 0, stage.value))
  }
  const stages: FunnelStage[] = raw.map(stage => ({
    ...stage,
    share: stage.value / Math.max(peaks.get(stage.unitGroup) ?? 0, 1),
    href: STAGE_HREF[stage.key] ?? null,
  }))

  const costPerLead = current.leads > 0 ? current.videoCostUsd / current.leads : null
  const previousCostPerLead = previous.leads > 0 ? previous.videoCostUsd / previous.leads : null
  const costPerVideo = current.costedVideos > 0 ? current.videoCostUsd / current.costedVideos : null
  const previousCostPerVideo = previous.costedVideos > 0 ? previous.videoCostUsd / previous.costedVideos : null

  const kpis: AnalyticsKpi[] = [
    {
      key: 'publications',
      label: 'Опубликовано',
      value: current.publications,
      unit: 'count',
      previous: previous.publications,
      better: 'up',
    },
    { key: 'views', label: 'Просмотры', value: current.views, unit: 'count', previous: previous.views, better: 'up' },
    { key: 'ctr', label: 'Средний CTR', value: ctr, unit: 'rate', previous: previousCtr, better: 'up' },
    { key: 'clicks', label: 'Переходы', value: current.clicks, unit: 'count', previous: previous.clicks, better: 'up' },
    { key: 'leads', label: 'Заявки', value: current.leads, unit: 'count', previous: previous.leads, better: 'up' },
    {
      key: 'costPerLead',
      label: 'Стоимость заявки',
      value: costPerLead,
      unit: 'money',
      previous: previousCostPerLead,
      better: 'down',
    },
    {
      key: 'costPerVideo',
      label: 'Стоимость ролика',
      value: costPerVideo,
      unit: 'money',
      previous: previousCostPerVideo,
      better: 'down',
    },
  ]

  return {
    period: periodToDto(scope),
    stages,
    kpis,
    productionScopeNote: hasPublicationOnlyFilters(scope),
    hasAttribution: current.clicks + current.leads + current.sales > 0,
  }
}
