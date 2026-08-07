/**
 * GET /api/accounts
 * Список социальных аккаунтов с фильтром по appId/platform/status.
 * Возвращает компактный shape для пикеров: lastPostedAt, profileCompleteness, app.name.
 *
 * Пагинация включается только тем, кто её попросил (`page` или `perPage`):
 * список аккаунтов читают ещё и пикеры модалок, и молча обрезать им выборку
 * двадцатью строками значит спрятать половину аккаунтов от оператора.
 *
 * Прогрев и лимит публикаций отдаются здесь же: прогрев до сих пор жил только
 * в `/api/admin/accounts-health`, а лимит площадки не выходил за пределы
 * адаптера публикации — из-за этого в списке аккаунтов не было ни колонки
 * «34 / 50», ни отметки «прогрет».
 */
const SORT_FIELDS = ['createdAt', 'displayName', 'lastPostedAt', 'status', 'totalPostsPublished'] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'social-upload' })

  const query = getQuery(event)
  const where: Record<string, unknown> = {}

  if (query.appId) {
    const appId = Number(query.appId)
    if (!Number.isNaN(appId) && appId > 0) {
      where.appId = appId
    }
  }

  if (query.platform) {
    const validPlatforms = ["youtube", "tiktok", "instagram"]
    if (validPlatforms.includes(query.platform as string)) {
      where.platform = query.platform
    }
  }

  if (query.status) {
    const validStatuses = ["active", "expired", "revoked"]
    if (validStatuses.includes(query.status as string)) {
      where.status = query.status
    }
  }

  const wantsPages = query.page !== undefined || query.perPage !== undefined
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(200, Math.max(1, Number(query.perPage) || 25))
  const orderBy = toOrderBy(
    parseSort(query, { allowed: SORT_FIELDS, defaultField: "createdAt" }),
    ["lastPostedAt"],
  )

  const total = await prisma.socialAccount.count({ where })

  const accounts = await prisma.socialAccount.findMany({
    where,
    orderBy,
    ...(wantsPages ? { skip: (page - 1) * perPage, take: perPage } : {}),
    select: {
      id: true,
      appId: true,
      platform: true,
      displayName: true,
      platformUserId: true,
      status: true,
      expiresAt: true,
      lastPostedAt: true,
      createdAt: true,
      updatedAt: true,
      // флаги наличия зашифрованных credentials (без расшифровки)
      loginEmail: true,
      loginPassword: true,
      // Метод постинга - api/browser_automation. UI отображает badge.
      postingMethod: true,
      // Part D: login-check status (badge на карточке только для browser_automation)
      loginCheckedAt: true,
      loginCheckedStatus: true,
      loginCheckedUsername: true,
      // прокси
      proxyId: true,
      // Прогрев: до сих пор был виден только на странице здоровья аккаунтов,
      // хотя решение «можно ли лить в этот аккаунт» принимают в списке.
      warmupStatus: true,
      lastWarmupAt: true,
      totalPostsPublished: true,
      // Лимит публикаций площадки — снимок в момент последней отправки.
      publishingQuotaUsage: true,
      publishingQuotaTotal: true,
      publishingQuotaAt: true,
      // Indigo browser profile — нужен в DTO чтобы UI 1:1:1 pre-check
      // в PostingJobCreateModal мог проверять и показывать бейдж.
      deviceProfileId: true,
      proxy: {
        select: {
          id: true,
          label: true,
          status: true,
        },
      },
      _count: { select: { uploads: true, groups: true } },
      app: { select: { id: true, name: true } },
      styleProfile: { select: { id: true, status: true, version: true } },
    },
  })

  // profileCompleteness: 0..100 на основе AccountStyleProfile.status
  const data = accounts.map((acc) => {
    const status = acc.styleProfile?.status ?? "not_set"
    const profileCompleteness =
      status === "complete" ? 100 : status === "partial" ? 50 : 0
    const hasLoginCredentials =
      Boolean(acc.loginEmail) || Boolean(acc.loginPassword)
    // не отдаём ciphertext наружу
    const { loginEmail: _le, loginPassword: _lp, ...safe } = acc
    void _le
    void _lp
    return {
      ...safe,
      profileCompleteness,
      hasLoginCredentials,
      // Замер лимита старше суток описывает уже другой день: квота площадки
      // катится 24 часа, и показывать вчерашнюю цифру как текущую нельзя.
      publishingQuotaStale: isLimitStale(acc.publishingQuotaAt),
    }
  })

  return {
    data,
    meta: {
      total,
      page: wantsPages ? page : 1,
      perPage: wantsPages ? perPage : total,
      totalPages: wantsPages ? Math.max(1, Math.ceil(total / perPage)) : 1,
    },
  }
})
