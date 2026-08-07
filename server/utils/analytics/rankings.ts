/**
 * Рейтинги сквозной аналитики: что сработало.
 *
 * Заслуга за заявку раздаётся по одной из двух моделей. `last` — публикация,
 * на которой заявка записана: так же считает CRM, и деньги в KPI идут по ней.
 * `first` — первое касание того же человека, сшитое по `messengerUserId`:
 * иначе вся заслуга достаётся посту с лид-магнитом, а хук, который человека
 * привёл, оказывается ни при чём.
 *
 * Сшивка — нижняя оценка: события без опознанного `messengerUserId` остаются
 * при своей публикации, потому что связать их не с чем.
 */

import { Prisma } from '../../../app/generated/prisma/client'
import type {
  AbComparison,
  AbVariantSide,
  AttributionModel,
  GeoSlice,
  RankedAccount,
  RankedHook,
  RankedTrendSource,
  RankedVideo,
  RankingsResult,
} from '~~/shared/types/analytics-funnel'
import { prisma } from '../prisma'
import type { AnalyticsScope } from './period'
import { periodToDto } from './period'
import { publicationFilterSql, uploadFilterSql } from './funnel'

const TOP_LIMIT = 5

/**
 * Заявки (или продажи) с раздачей заслуги по выбранной модели.
 *
 * Фрагмент подставляется в начало запроса: пересобирать его в каждом запросе
 * заново нельзя — модель атрибуции должна быть одна на весь экран.
 */
function creditedCte(scope: AnalyticsScope, model: AttributionModel, type: string) {
  return Prisma.sql`
    WITH conv AS (
      SELECT e.id, e."publicationId" AS last_pub, e."messengerUserId", e."occurredAt"
      FROM "AttributionEvent" e
      JOIN "FactoryPublication" p ON p.id = e."publicationId"
      WHERE e.type = ${type}
        AND e."occurredAt" >= ${scope.from} AND e."occurredAt" < ${scope.to}
        ${publicationFilterSql(scope)}
    ),
    credited AS (
      SELECT c.id,
             CASE WHEN ${model}::text = 'first' THEN COALESCE(ft.pub, c.last_pub) ELSE c.last_pub END AS pub_id
      FROM conv c
      LEFT JOIN LATERAL (
        SELECT f."publicationId" AS pub
        FROM "AttributionEvent" f
        WHERE c."messengerUserId" IS NOT NULL
          AND f."messengerUserId" = c."messengerUserId"
          AND f."occurredAt" <= c."occurredAt"
        ORDER BY f."occurredAt" ASC
        LIMIT 1
      ) ft ON TRUE
    )
  `
}

/** Топ публикаций по заявкам вместе с просмотрами и переходами. */
async function topVideos(scope: AnalyticsScope, model: AttributionModel): Promise<RankedVideo[]> {
  const rows = await prisma.$queryRaw<Array<{
    uploadId: number | null
    videoId: number | null
    title: string | null
    displayName: string | null
    platform: string | null
    views: number | null
    clicks: number | null
    leads: bigint
  }>>`
    ${creditedCte(scope, model, 'conversion_submitted')}
    SELECT p."uploadId" AS "uploadId",
           p."videoId" AS "videoId",
           u.title AS title,
           sa."displayName" AS "displayName",
           sa.platform::text AS platform,
           m.views AS views,
           cl.count AS clicks,
           COUNT(*)::bigint AS leads
    FROM credited c
    JOIN "FactoryPublication" p ON p.id = c.pub_id
    LEFT JOIN "Upload" u ON u.id = p."uploadId"
    LEFT JOIN "SocialAccount" sa ON sa.id = p."socialAccountId"
    LEFT JOIN LATERAL (
      SELECT pm.views FROM "PostMetrics" pm
      WHERE pm."uploadId" = p."uploadId"
      ORDER BY pm."collectedAt" DESC LIMIT 1
    ) m ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count FROM "AttributionEvent" e
      WHERE e."publicationId" = p.id AND e.type = 'messenger_opened'
        AND e."occurredAt" >= ${scope.from} AND e."occurredAt" < ${scope.to}
    ) cl ON TRUE
    GROUP BY p."uploadId", p."videoId", u.title, sa."displayName", sa.platform, m.views, cl.count
    ORDER BY leads DESC, views DESC NULLS LAST
    LIMIT ${TOP_LIMIT}
  `

  return rows.map(row => ({
    uploadId: row.uploadId ?? 0,
    videoId: row.videoId,
    title: row.title ?? 'Без названия',
    code: row.videoId ? `vid_${row.videoId}` : `pub_${row.uploadId ?? 0}`,
    accountName: row.displayName,
    platform: (row.platform as RankedVideo['platform']) ?? null,
    views: Number(row.views ?? 0),
    clicks: Number(row.clicks ?? 0),
    leads: Number(row.leads),
  }))
}

async function leadsByAccount(scope: AnalyticsScope, model: AttributionModel): Promise<RankedAccount[]> {
  const rows = await prisma.$queryRaw<Array<{
    socialAccountId: number
    name: string
    platform: string
    leads: bigint
  }>>`
    ${creditedCte(scope, model, 'conversion_submitted')}
    SELECT sa.id AS "socialAccountId",
           sa."displayName" AS name,
           sa.platform::text AS platform,
           COUNT(*)::bigint AS leads
    FROM credited c
    JOIN "FactoryPublication" p ON p.id = c.pub_id
    JOIN "SocialAccount" sa ON sa.id = p."socialAccountId"
    GROUP BY sa.id, sa."displayName", sa.platform
    ORDER BY leads DESC
    LIMIT 8
  `
  return rows.map(row => ({
    socialAccountId: row.socialAccountId,
    name: row.name,
    platform: row.platform as RankedAccount['platform'],
    leads: Number(row.leads),
  }))
}

/** Разрез заявок по стране тренда-источника. */
async function leadsByGeo(scope: AnalyticsScope, model: AttributionModel): Promise<GeoSlice[]> {
  const rows = await prisma.$queryRaw<Array<{ geo: string | null; leads: bigint }>>`
    ${creditedCte(scope, model, 'conversion_submitted')}
    SELECT t.geo AS geo, COUNT(*)::bigint AS leads
    FROM credited c
    JOIN "FactoryPublication" p ON p.id = c.pub_id
    LEFT JOIN "Upload" u ON u.id = p."uploadId"
    LEFT JOIN "Video" v ON v.id = u."videoId"
    LEFT JOIN "Scenario" s ON s.id = v."scenarioId"
    LEFT JOIN "Trend" t ON t.id = s."trendId"
    WHERE t.geo IS NOT NULL AND t.geo <> ''
    GROUP BY t.geo
    ORDER BY leads DESC
    LIMIT 6
  `
  return rows.map(row => ({ geo: row.geo ?? '', leads: Number(row.leads) }))
}

/**
 * Хуки берутся из выбранного варианта сценария, а не из гипотезы: вариант
 * есть у каждого ролика классического пути, а гипотеза — только у фабричного.
 */
async function topHooks(scope: AnalyticsScope): Promise<RankedHook[]> {
  const rows = await prisma.$queryRaw<Array<{
    hook: string
    publications: bigint
    views: bigint
    clicks: bigint
  }>>`
    SELECT sv.hook AS hook,
           COUNT(DISTINCT u.id)::bigint AS publications,
           COALESCE(SUM(m.views), 0)::bigint AS views,
           COALESCE(SUM(cl.count), 0)::bigint AS clicks
    FROM "Upload" u
    JOIN "SocialAccount" sa ON sa.id = u."socialAccountId"
    JOIN "Video" v ON v.id = u."videoId"
    JOIN "ScenarioVariant" sv ON sv.id = v."variantId"
    LEFT JOIN LATERAL (
      SELECT pm.views FROM "PostMetrics" pm
      WHERE pm."uploadId" = u.id ORDER BY pm."collectedAt" DESC LIMIT 1
    ) m ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count FROM "AttributionEvent" e
      JOIN "FactoryPublication" fp ON fp.id = e."publicationId"
      WHERE fp."uploadId" = u.id AND e.type = 'messenger_opened'
        AND e."occurredAt" >= ${scope.from} AND e."occurredAt" < ${scope.to}
    ) cl ON TRUE
    WHERE u.status::text = 'published'
      AND u."createdAt" >= ${scope.from} AND u."createdAt" < ${scope.to}
      AND sv.hook <> ''
      ${uploadFilterSql(scope)}
    GROUP BY sv.hook
    ORDER BY clicks DESC, views DESC
    LIMIT ${TOP_LIMIT}
  `

  return rows.map(row => {
    const views = Number(row.views)
    const clicks = Number(row.clicks)
    return {
      key: row.hook,
      label: row.hook,
      publications: Number(row.publications),
      views,
      clicks,
      ctr: views > 0 ? clicks / views : 0,
    }
  })
}

/**
 * Источник тренда — площадка и ключевое слово парсинга: именно так профиль
 * парсинга и описывает свою выборку. Сортировка по продажам, а не по числу
 * трендов: пятьсот трендов без единой продажи ниже двухсот с продажами.
 */
async function topTrendSources(scope: AnalyticsScope, model: AttributionModel): Promise<RankedTrendSource[]> {
  const [trendRows, saleRows] = await Promise.all([
    prisma.$queryRaw<Array<{ platform: string; keyword: string | null; trends: bigint }>>`
      SELECT t.platform::text AS platform, t.keyword AS keyword, COUNT(*)::bigint AS trends
      FROM "Trend" t
      WHERE t."importedAt" >= ${scope.from} AND t."importedAt" < ${scope.to}
        AND t."isDeleted" = FALSE
        AND (${scope.appId}::int IS NULL OR t."appId" = ${scope.appId}::int)
        AND (${scope.pipelineId}::int IS NULL OR t."pipelineId" = ${scope.pipelineId}::int)
        AND (${scope.runId}::int IS NULL OR t."runId" = ${scope.runId}::int)
      GROUP BY t.platform, t.keyword
    `,
    prisma.$queryRaw<Array<{ platform: string | null; keyword: string | null; sales: bigint }>>`
      ${creditedCte(scope, model, 'sale_attributed')}
      SELECT t.platform::text AS platform, t.keyword AS keyword, COUNT(*)::bigint AS sales
      FROM credited c
      JOIN "FactoryPublication" p ON p.id = c.pub_id
      LEFT JOIN "Upload" u ON u.id = p."uploadId"
      LEFT JOIN "Video" v ON v.id = u."videoId"
      LEFT JOIN "Scenario" s ON s.id = v."scenarioId"
      LEFT JOIN "Trend" t ON t.id = s."trendId"
      WHERE t.id IS NOT NULL
      GROUP BY t.platform, t.keyword
    `,
  ])

  const PLATFORM_LABEL: Record<string, string> = {
    tiktok: 'TikTok',
    instagram: 'Instagram',
    youtube: 'YouTube',
  }

  const sales = new Map<string, number>()
  for (const row of saleRows) {
    sales.set(`${row.platform ?? ''}|${row.keyword ?? ''}`, Number(row.sales))
  }

  return trendRows
    .map(row => {
      const key = `${row.platform}|${row.keyword ?? ''}`
      const platformLabel = PLATFORM_LABEL[row.platform] ?? row.platform
      return {
        key,
        label: row.keyword ? `${platformLabel} · ${row.keyword}` : platformLabel,
        trends: Number(row.trends),
        sales: sales.get(key) ?? 0,
      }
    })
    .sort((a, b) => b.sales - a.sales || b.trends - a.trends)
    .slice(0, TOP_LIMIT)
}

/**
 * A/B: два и более варианта одного сценария, у каждого своя публикация.
 * Сравнение честно только внутри сценария — тренд, персонаж и аккаунты у
 * вариантов общие, отличается хук.
 */
async function abComparisons(scope: AnalyticsScope): Promise<AbComparison[]> {
  const rows = await prisma.$queryRaw<Array<{
    scenarioId: number
    variantIndex: number
    hook: string
    title: string
    uploadId: number
    views: number | null
    clicks: number
    leads: number
  }>>`
    SELECT s.id AS "scenarioId",
           sv."variantIndex" AS "variantIndex",
           sv.hook AS hook,
           sv.title AS title,
           u.id AS "uploadId",
           m.views AS views,
           cl.count AS clicks,
           ld.count AS leads
    FROM "Upload" u
    JOIN "SocialAccount" sa ON sa.id = u."socialAccountId"
    JOIN "Video" v ON v.id = u."videoId"
    JOIN "ScenarioVariant" sv ON sv.id = v."variantId"
    JOIN "Scenario" s ON s.id = v."scenarioId"
    LEFT JOIN LATERAL (
      SELECT pm.views FROM "PostMetrics" pm
      WHERE pm."uploadId" = u.id ORDER BY pm."collectedAt" DESC LIMIT 1
    ) m ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count FROM "AttributionEvent" e
      JOIN "FactoryPublication" fp ON fp.id = e."publicationId"
      WHERE fp."uploadId" = u.id AND e.type = 'messenger_opened'
        AND e."occurredAt" >= ${scope.from} AND e."occurredAt" < ${scope.to}
    ) cl ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count FROM "AttributionEvent" e
      JOIN "FactoryPublication" fp ON fp.id = e."publicationId"
      WHERE fp."uploadId" = u.id AND e.type = 'conversion_submitted'
        AND e."occurredAt" >= ${scope.from} AND e."occurredAt" < ${scope.to}
    ) ld ON TRUE
    WHERE u.status::text = 'published'
      AND u."createdAt" >= ${scope.from} AND u."createdAt" < ${scope.to}
      ${uploadFilterSql(scope)}
    ORDER BY s.id, sv."variantIndex"
  `

  const byScenario = new Map<number, { title: string; variants: Map<number, AbVariantSide> }>()
  for (const row of rows) {
    let entry = byScenario.get(row.scenarioId)
    if (!entry) {
      entry = { title: row.title, variants: new Map() }
      byScenario.set(row.scenarioId, entry)
    }
    const existing = entry.variants.get(row.variantIndex)
    const views = Number(row.views ?? 0)
    const clicks = Number(row.clicks ?? 0)
    const leads = Number(row.leads ?? 0)
    if (existing) {
      // Один вариант мог уйти на несколько аккаунтов — складываем.
      existing.views += views
      existing.clicks += clicks
      existing.leads += leads
      existing.ctr = existing.views > 0 ? existing.clicks / existing.views : 0
      continue
    }
    entry.variants.set(row.variantIndex, {
      variantIndex: row.variantIndex,
      hook: row.hook,
      uploadId: row.uploadId,
      views,
      clicks,
      leads,
      ctr: views > 0 ? clicks / views : 0,
    })
  }

  const comparisons: AbComparison[] = []
  for (const [scenarioId, entry] of byScenario) {
    if (entry.variants.size < 2) continue
    const variants = [...entry.variants.values()].sort((a, b) => a.variantIndex - b.variantIndex)
    const best = variants.reduce((top, item) => (item.leads > top.leads ? item : top), variants[0]!)
    const bestIsAlone = variants.filter(item => item.leads === best.leads).length === 1
    comparisons.push({
      scenarioId,
      title: entry.title,
      code: `scr_${scenarioId}`,
      variants,
      winnerIndex: bestIsAlone && best.leads > 0 ? variants.indexOf(best) : null,
    })
  }

  return comparisons
    .sort((a, b) => {
      const leads = (item: AbComparison) => item.variants.reduce((sum, variant) => sum + variant.leads, 0)
      const views = (item: AbComparison) => item.variants.reduce((sum, variant) => sum + variant.views, 0)
      return leads(b) - leads(a) || views(b) - views(a)
    })
    .slice(0, 3)
}

export async function computeRankings(
  scope: AnalyticsScope,
  model: AttributionModel,
): Promise<RankingsResult> {
  const [videos, accounts, geo, hooks, trendSources, abTests] = await Promise.all([
    topVideos(scope, model),
    leadsByAccount(scope, model),
    leadsByGeo(scope, model),
    topHooks(scope),
    topTrendSources(scope, model),
    abComparisons(scope),
  ])

  return {
    model,
    period: periodToDto(scope),
    topVideos: videos,
    byAccount: accounts,
    geo,
    hooks,
    trendSources,
    abTests,
  }
}
