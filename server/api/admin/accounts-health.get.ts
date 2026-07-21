/**
 * GET /api/admin/accounts-health
 * Агрегированное состояние всех социальных аккаунтов (трек G).
 *
 * ВАЖНО: ответ НЕ содержит секретов loginEmail/loginPassword/twoFASecret.
 * Вместо них возвращаются boolean-флаги hasLoginCredentials и has2FA.
 */
import type {
  AccountHealthRow,
  AccountsHealthByPlatform,
  AccountsHealthProxyStatus,
} from "~~/shared/types/accounts-health"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    total,
    activeCount,
    expiredCount,
    revokedCount,
    withoutCredentials,
    withoutProxy,
    withDeadProxy,
    withDegradedProxy,
    withoutWarmup7d,
    coldAccounts,
    without2FA,
    byPlatformGroups,
    perAccount,
  ] = await Promise.all([
    prisma.socialAccount.count(),
    prisma.socialAccount.count({ where: { status: "active" } }),
    prisma.socialAccount.count({ where: { status: "expired" } }),
    prisma.socialAccount.count({ where: { status: "revoked" } }),
    prisma.socialAccount.count({
      where: { OR: [{ loginEmail: null }, { loginPassword: null }] },
    }),
    prisma.socialAccount.count({ where: { proxyId: null } }),
    prisma.socialAccount.count({ where: { proxy: { status: "dead" } } }),
    prisma.socialAccount.count({ where: { proxy: { status: "degraded" } } }),
    prisma.socialAccount.count({
      where: {
        OR: [{ lastWarmupAt: null }, { lastWarmupAt: { lt: sevenDaysAgo } }],
      },
    }),
    prisma.socialAccount.count({ where: { warmupStatus: "cold" } }),
    prisma.socialAccount.count({ where: { twoFASecret: null } }),
    prisma.socialAccount.groupBy({
      by: ["platform"],
      _count: { _all: true },
    }),
    prisma.socialAccount.findMany({
      select: {
        id: true,
        displayName: true,
        platform: true,
        status: true,
        appId: true,
        app: { select: { id: true, name: true } },
        loginEmail: true,
        loginPassword: true,
        twoFASecret: true,
        proxyId: true,
        proxy: { select: { id: true, label: true, status: true } },
        deviceProfileId: true,
        warmupStatus: true,
        lastWarmupAt: true,
        lastPostedAt: true,
        totalPostsPublished: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const accounts: AccountHealthRow[] = perAccount.map((acc) => {
    const hasLoginCredentials = Boolean(acc.loginEmail && acc.loginPassword)
    const has2FA = Boolean(acc.twoFASecret)
    const hasProxy = Boolean(acc.proxyId)
    const hasDeviceProfile = Boolean(acc.deviceProfileId)
    const isProxyHealthy = acc.proxy?.status === "healthy"
    const recentWarmup =
      acc.lastWarmupAt !== null && acc.lastWarmupAt >= sevenDaysAgo
    const isActive = acc.status === "active"
    const isWarmupReady = acc.warmupStatus === "ready"

    let score = 0
    if (hasLoginCredentials) score += 12.5
    if (has2FA) score += 12.5
    if (hasProxy) score += 12.5
    if (isProxyHealthy) score += 12.5
    if (hasDeviceProfile) score += 12.5
    if (isWarmupReady) score += 12.5
    if (recentWarmup) score += 12.5
    if (isActive) score += 12.5

    return {
      id: acc.id,
      displayName: acc.displayName,
      platform: acc.platform,
      status: acc.status,
      app: acc.app ? { id: acc.app.id, name: acc.app.name } : null,
      hasLoginCredentials,
      has2FA,
      hasProxy,
      proxyId: acc.proxyId,
      proxyStatus: acc.proxyId
        ? ((acc.proxy?.status as AccountsHealthProxyStatus) ?? "unverified")
        : null,
      proxyLabel: acc.proxy?.label ?? null,
      hasDeviceProfile,
      warmupStatus: acc.warmupStatus,
      lastWarmupAt: acc.lastWarmupAt ? acc.lastWarmupAt.toISOString() : null,
      lastPostedAt: acc.lastPostedAt ? acc.lastPostedAt.toISOString() : null,
      totalPostsPublished: acc.totalPostsPublished,
      completenessPercent: Math.round(score),
    }
  })

  accounts.sort((a, b) => a.completenessPercent - b.completenessPercent)

  const byPlatform: AccountsHealthByPlatform = {
    tiktok: byPlatformGroups.find((g) => g.platform === "tiktok")?._count._all ?? 0,
    youtube: byPlatformGroups.find((g) => g.platform === "youtube")?._count._all ?? 0,
    instagram:
      byPlatformGroups.find((g) => g.platform === "instagram")?._count._all ?? 0,
  }

  return {
    data: {
      summary: {
        total,
        activeCount,
        expiredCount,
        revokedCount,
        withoutCredentials,
        withoutProxy,
        withDeadProxy,
        withDegradedProxy,
        withoutWarmup7d,
        coldAccounts,
        without2FA,
      },
      byPlatform,
      accounts,
    },
  }
})
