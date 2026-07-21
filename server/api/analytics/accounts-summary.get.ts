/**
 * GET /api/analytics/accounts-summary
 *
 * Сводка Apify-метрик по аккаунтам для /analytics → таб «Аккаунты».
 *
 * Что возвращает per-account:
 *   - account: id/displayName/platform/platformHandle/status/app
 *   - latestOkSnapshot: последний 'ok'-снимок AccountMetricsSnapshot (DTO с BigInt→string)
 *   - recentSnapshots: до 14 последних снимков для sparkline (DESC по fetchedAt)
 *   - lastFetchedAt: timestamp последнего любого снимка (для индикатора свежести)
 *   - snapshotsCount: всего снимков (для отображения «N снимков»)
 *
 * Также возвращает aggregate-блок:
 *   - accountsTotal: сколько аккаунтов в выборке
 *   - accountsWithMetrics: у скольких есть хотя бы один 'ok'-снимок
 *   - totalFollowers: сумма followers по последним 'ok' (string из BigInt)
 *   - avgEngagement: средний engagementRate (0..1) по последним 'ok'
 *
 * Фильтры (консистентно с analytics/dashboard.get.ts и analytics/posts.get.ts):
 *   ?appId=N          — фильтр по приложению (опционально)
 *   ?platform=tiktok  — фильтр по платформе (опционально, valid: tiktok|youtube|instagram)
 *
 * RBAC: canRead + moduleSlug=analytics.
 *
 * Важно: Apify-метрики собираются независимо от postingMethod (api / browser_automation),
 * т.к. скрейпят публичный профиль. Покрывает и OAuth-track Upload, и новый PostingJob track.
 */
import { serializeSnapshot } from "../../utils/account-metrics-serialize"
import type { Platform } from "~~/app/generated/prisma/client"

const VALID_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"]

// Sparkline компонент уже умеет brать ok-only и переворачивать в ASC — мы только
// гарантируем DESC порядок и ограничиваем кол-вом.
const RECENT_SNAPSHOTS_LIMIT = 14

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "analytics",
  })

  const query = getQuery(event)

  const appIdRaw = Number(query.appId)
  const appIdFilter =
    Number.isFinite(appIdRaw) && appIdRaw > 0 ? appIdRaw : undefined

  const platformFilter =
    typeof query.platform === "string"
    && VALID_PLATFORMS.includes(query.platform as Platform)
      ? (query.platform as Platform)
      : undefined

  const accountWhere: Record<string, unknown> = {}
  if (appIdFilter !== undefined) accountWhere.appId = appIdFilter
  if (platformFilter !== undefined) accountWhere.platform = platformFilter

  const accounts = await prisma.socialAccount.findMany({
    where: accountWhere,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      displayName: true,
      platform: true,
      platformHandle: true,
      status: true,
      app: { select: { id: true, name: true } },
      // Последние N снимков (DESC) — этого достаточно и для sparkline,
      // и для определения latestOkSnapshot (первый ok в массиве).
      metricsSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: RECENT_SNAPSHOTS_LIMIT,
      },
      _count: { select: { metricsSnapshots: true } },
    },
  })

  let totalFollowersBig = 0n
  let accountsWithMetrics = 0
  let engagementSum = 0
  let engagementCount = 0

  const items = accounts.map((acc) => {
    const recentSerialized = acc.metricsSnapshots.map((s) =>
      serializeSnapshot(s, { includeRaw: false }),
    )
    const latestOk = recentSerialized.find((s) => s.status === "ok") ?? null
    const lastFetchedAt = recentSerialized[0]?.fetchedAt ?? null

    if (latestOk) {
      accountsWithMetrics += 1
      if (latestOk.followers !== null) {
        try {
          totalFollowersBig += BigInt(latestOk.followers)
        } catch {
          // followers пришёл некорректным — игнорируем в агрегате
        }
      }
      if (latestOk.engagementRate !== null) {
        engagementSum += latestOk.engagementRate
        engagementCount += 1
      }
    }

    return {
      account: {
        id: acc.id,
        displayName: acc.displayName,
        platform: acc.platform,
        platformHandle: acc.platformHandle,
        status: acc.status,
        app: acc.app,
      },
      latestOkSnapshot: latestOk,
      recentSnapshots: recentSerialized,
      lastFetchedAt,
      snapshotsCount: acc._count.metricsSnapshots,
    }
  })

  return {
    data: {
      items,
      aggregate: {
        accountsTotal: items.length,
        accountsWithMetrics,
        totalFollowers: totalFollowersBig.toString(),
        avgEngagement:
          engagementCount > 0 ? engagementSum / engagementCount : null,
      },
    },
  }
})
