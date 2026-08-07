import type { UploadListMeta } from "../../../shared/types/upload"

const VALID_STATUSES = ["pending", "uploading", "published", "failed", "scheduled", "canceled", "blocked_by_env"] as const
const SORT_FIELDS = ["createdAt", "updatedAt", "status", "scheduledAt", "lastAttemptAt"] as const

/**
 * GET /api/uploads
 * Список загрузок с фильтрами и пагинацией.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'social-upload' })

  const query = getQuery(event)

  // Пагинация
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20))
  const skip = (page - 1) * perPage

  // Сортировка
  const orderBy = toOrderBy(
    parseSort(query, { allowed: SORT_FIELDS, defaultField: 'createdAt' }),
    ['scheduledAt', 'lastAttemptAt'],
  )

  // Фильтры
  const where: Record<string, unknown> = {}

  if (query.status && VALID_STATUSES.includes(query.status as typeof VALID_STATUSES[number])) {
    where.status = query.status
  }

  if (query.videoId) {
    const videoId = Number(query.videoId)
    if (!Number.isNaN(videoId) && videoId > 0) {
      where.videoId = videoId
    }
  }

  if (query.socialAccountId) {
    const accountId = Number(query.socialAccountId)
    if (!Number.isNaN(accountId) && accountId > 0) {
      where.socialAccountId = accountId
    }
  }

  // --- Pipeline/run filter: фильтрация "К юниту" из монитора исполнений ---
  const runIdFilter = Number(query.runId)
  if (Number.isFinite(runIdFilter) && runIdFilter > 0) {
    where.runId = runIdFilter
  }
  const pipelineIdFilter = Number(query.pipelineId)
  if (Number.isFinite(pipelineIdFilter) && pipelineIdFilter > 0) {
    where.pipelineId = pipelineIdFilter
  }

  const [uploads, total] = await Promise.all([
    prisma.upload.findMany({
      where,
      orderBy,
      skip,
      take: perPage,
      include: {
        socialAccount: {
          select: {
            id: true,
            platform: true,
            displayName: true,
            status: true,
            // 1:1:1 anti-detect видимость на карточке /uploads —
            // те же поля что и в /api/accounts (паттерн уже работает там).
            postingMethod: true,
            proxyId: true,
            deviceProfileId: true,
            loginCheckedAt: true,
            loginCheckedStatus: true,
            loginCheckedUsername: true,
            proxy: {
              select: { id: true, label: true, status: true },
            },
          },
        },
        video: {
          select: {
            id: true,
            status: true,
            fileUrl: true,
          },
        },
        // Связь Upload → PostingJob (1:1 opt-in, Upload.uploadId @unique nullable).
        // На UI — chip «через PostingJob #xxx» с переходом на /posting-jobs.
        // ВАЖНО: это slow-track интеграция, постинг через PostingJob может работать
        // без Upload вообще (browser_automation track создаёт только PostingJob).
        postingJob: {
          select: { id: true, status: true, errorCategory: true },
        },
      },
    }),
    prisma.upload.count({ where }),
  ])

  const meta: UploadListMeta = {
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  }

  return { data: uploads, meta }
})
