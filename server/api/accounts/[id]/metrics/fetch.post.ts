/**
 * POST /api/accounts/:id/metrics/fetch
 *
 * Запускает Apify profile-scraper для аккаунта и сохраняет AccountMetricsSnapshot.
 *
 * Идемпотентность 24h rolling: если в последние 24 часа уже есть snapshot со
 * status='ok', возвращаем его (skipped=true) — не дёргаем Apify повторно.
 * Принудительный refetch — ?force=1.
 *
 * RBAC: canWrite + moduleSlug=social-upload + appAccess + accountAccess (по displayName).
 *
 * Возможные ответы:
 *   200 { data: { skipped: false, snapshot } } — успешный fetch
 *   200 { data: { skipped: true, snapshot, reason: 'already_fetched_today' } }
 *   400 — невалидный id или platformHandle отсутствует
 *   403 — нет прав/доступа
 *   404 — аккаунт не найден
 *   502 — Apify не смог отработать (сохраняется error-snapshot для диагностики)
 */
import { fetchAccountMetrics } from "../../../../utils/apify-client"
import { serializeSnapshot } from "../../../../utils/account-metrics-serialize"
import type { Prisma } from "../../../../../app/generated/prisma/client"
import type {
  AccountMetricsResult,
  MetricsPlatform,
} from "../../../../../shared/types/account-metrics"

const SUPPORTED_PLATFORMS: MetricsPlatform[] = ["tiktok", "instagram", "youtube"]
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  // 1. Auth-гейт первым: 401 раньше 404. Полный scoped check (appId/account) — после загрузки аккаунта.
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  // 2. Парс id заранее, чтобы 400 не зависел от БД
  const id = Number(getRouterParam(event, "id"))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      data: {
        message: "Неверный ID аккаунта",
        code: "invalid_id",
      },
    })
  }

  // 3. Загружаем аккаунт для получения appId/displayName под полноценный scoped check
  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: {
      id: true,
      appId: true,
      platform: true,
      platformHandle: true,
      displayName: true,
    },
  })
  if (!account) {
    throw createError({
      statusCode: 404,
      data: { message: "Аккаунт не найден", code: "account_not_found" },
    })
  }

  // 4. Полный scoped check с appId/accountName (admin bypass внутри)
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
    appId: account.appId,
    accountName: account.displayName,
  })

  // 5. Поддержка платформы (на случай если в БД появится новая Platform-enum)
  if (!SUPPORTED_PLATFORMS.includes(account.platform as MetricsPlatform)) {
    throw createError({
      statusCode: 400,
      data: {
        message: `Сбор статистики для платформы "${account.platform}" пока не поддерживается`,
        code: "platform_unsupported",
        suggestion: "Поддерживаются tiktok, instagram, youtube",
      },
    })
  }

  // 6. platformHandle обязателен — без него scraper не знает что собирать
  if (!account.platformHandle) {
    throw createError({
      statusCode: 400,
      data: {
        message: "Укажите handle аккаунта (без @) для сбора статистики",
        code: "platform_handle_missing",
        suggestion: "Откройте вкладку 'Доступы' и заполните поле handle",
      },
    })
  }

  const query = getQuery(event)
  const force = query.force === "1" || query.force === "true"

  // 7. Idempotency: 24h rolling — последний ok-снимок блокирует новый fetch
  if (!force) {
    const recent = await prisma.accountMetricsSnapshot.findFirst({
      where: {
        socialAccountId: id,
        status: "ok",
        fetchedAt: { gte: new Date(Date.now() - TWENTY_FOUR_HOURS_MS) },
      },
      orderBy: { fetchedAt: "desc" },
    })
    if (recent) {
      return {
        data: {
          skipped: true as const,
          reason: "already_fetched_today" as const,
          snapshot: serializeSnapshot(recent, { includeRaw: false }),
        },
      }
    }
  }

  // 8. Fetch через Apify. Любой throw сохраняем как error-snapshot и отдаём 502.
  const platform = account.platform as MetricsPlatform
  let result: AccountMetricsResult
  try {
    result = await fetchAccountMetrics(
      account.appId,
      platform,
      account.platformHandle,
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "неизвестная ошибка Apify"
    // Сохраняем error-snapshot для post-mortem диагностики
    await prisma.accountMetricsSnapshot.create({
      data: {
        socialAccountId: id,
        status: "error",
        errorMessage: errMsg.slice(0, 1000),
        rawData: { sampleSize: 0, posts: [] },
      },
    })
    throw createError({
      statusCode: 502,
      data: {
        message: `Apify не смог собрать данные: ${errMsg}`,
        code: "apify_fetch_failed",
        suggestion:
          "Проверьте handle и доступность профиля. Повторите попытку через несколько минут.",
      },
    })
  }

  // 9. Сохраняем snapshot (даже если result.status='error' — для истории)
  const snapshot = await prisma.accountMetricsSnapshot.create({
    data: {
      socialAccountId: id,
      followers: result.followers,
      following: result.following,
      totalViews: result.totalViews,
      totalLikes: result.totalLikes,
      totalComments: result.totalComments,
      postsCount: result.postsCount,
      avgViewsPer30d: result.avgViewsPer30d,
      engagementRate: result.engagementRate,
      bio: result.bio,
      avatarUrl: result.avatarUrl,
      isVerified: result.isVerified,
      status: result.status,
      errorMessage: result.errorMessage ?? null,
      // Каст: NormalizedPost содержит optional shareCount?, что делает его
      // несовместимым со strict InputJsonValue. JSON-сериализация работает корректно.
      rawData: {
        sampleSize: result.sampleSize,
        posts: result.posts,
      } as unknown as Prisma.InputJsonValue,
    },
  })

  return {
    data: {
      skipped: false as const,
      snapshot: serializeSnapshot(snapshot, { includeRaw: true }),
    },
  }
})
