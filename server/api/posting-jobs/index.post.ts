/**
 * POST /api/posting-jobs
 *
 * Создание нового PostingJob (идемпотентно по videoId+socialAccountId+scheduledAt).
 *
 * Body:
 *   videoId: number (required)
 *   socialAccountId: number (required)
 *   platform: Platform (required)
 *   contentSnapshot: object (required — для youtube ужесточённая валидация)
 *   scheduledAt: ISO datetime (optional — если нет, статус сразу queued)
 *   runId: number (optional)
 *   pipelineId: number (optional)
 *   uploadId: number (optional)
 *   maxAttempts: number (optional, default 3)
 */
import type { Platform, Prisma } from "~~/app/generated/prisma/client"
import {
  validateYoutubeSnapshot,
  YoutubeSnapshotValidationError,
} from "~~/server/utils/posting/youtube-snapshot-validator"
import {
  validateInstagramSnapshot,
  InstagramSnapshotValidationError,
} from "~~/server/utils/posting/instagram-snapshot-validator"
import { assertOneToOneForBrowserAutomation } from "~~/server/utils/accounts/one-to-one-guard"

const ALL_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"]

interface CreateBody {
  videoId?: unknown
  socialAccountId?: unknown
  platform?: unknown
  contentSnapshot?: unknown
  scheduledAt?: unknown
  runId?: unknown
  pipelineId?: unknown
  uploadId?: unknown
  maxAttempts?: unknown
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "social-upload",
  })

  const body = await readBody<CreateBody>(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  const videoId = Number(body.videoId)
  if (!Number.isFinite(videoId) || videoId <= 0) {
    throw createError({ statusCode: 400, message: "Поле 'videoId' обязательно (положительное число)" })
  }

  const socialAccountId = Number(body.socialAccountId)
  if (!Number.isFinite(socialAccountId) || socialAccountId <= 0) {
    throw createError({ statusCode: 400, message: "Поле 'socialAccountId' обязательно (положительное число)" })
  }

  if (typeof body.platform !== "string" || !ALL_PLATFORMS.includes(body.platform as Platform)) {
    throw createError({
      statusCode: 400,
      message: `Поле 'platform' обязательно. Допустимые: ${ALL_PLATFORMS.join(", ")}`,
    })
  }
  const platform = body.platform as Platform

  if (!body.contentSnapshot || typeof body.contentSnapshot !== "object" || Array.isArray(body.contentSnapshot)) {
    throw createError({ statusCode: 400, message: "Поле 'contentSnapshot' обязательно (объект)" })
  }
  const contentSnapshot = body.contentSnapshot as Record<string, unknown>

  // Платформо-специфичная валидация snapshot. YouTube ужесточён:
  // обязательны title (≤100), description (≤5000) опц., hashtags[] опц.,
  // youtube.visibility, youtube.madeForKids. Никаких дефолтов на этом edge —
  // fail-safe для постинг-фермы (случайный snapshot не публикует контент).
  if (platform === "youtube") {
    try {
      validateYoutubeSnapshot(contentSnapshot)
    } catch (err) {
      if (err instanceof YoutubeSnapshotValidationError) {
        throw createError({ statusCode: 400, message: err.message })
      }
      throw err
    }
  } else if (platform === "instagram") {
    // Instagram: caption+хэштеги ≤2200 (одно поле), ≤30 тегов без пробелов.
    // Нет visibility/madeForKids.
    try {
      validateInstagramSnapshot(contentSnapshot)
    } catch (err) {
      if (err instanceof InstagramSnapshotValidationError) {
        throw createError({ statusCode: 400, message: err.message })
      }
      throw err
    }
  }

  let scheduledAt: Date | null = null
  if (body.scheduledAt !== undefined && body.scheduledAt !== null) {
    if (typeof body.scheduledAt !== "string") {
      throw createError({ statusCode: 400, message: "Поле 'scheduledAt' должно быть ISO-строкой" })
    }
    const d = new Date(body.scheduledAt)
    if (Number.isNaN(d.getTime())) {
      throw createError({ statusCode: 400, message: "Поле 'scheduledAt' имеет неверный формат" })
    }
    scheduledAt = d
  }

  // Явный maxAttempts из body (если задан) валидируем сразу; иначе дефолт по методу
  // постинга резолвим ниже, после фетча аккаунта (browser_automation → 5, api → 3).
  let explicitMaxAttempts: number | null = null
  if (body.maxAttempts !== undefined && body.maxAttempts !== null) {
    const m = Number(body.maxAttempts)
    if (!Number.isFinite(m) || m < 1 || m > 10) {
      throw createError({
        statusCode: 400,
        message: "Поле 'maxAttempts' должно быть числом от 1 до 10",
      })
    }
    explicitMaxAttempts = m
  }

  // Проверяем существование Video и SocialAccount (+ proxy для gating)
  const [video, account] = await Promise.all([
    prisma.video.findUnique({ where: { id: videoId }, select: { id: true } }),
    prisma.socialAccount.findUnique({
      where: { id: socialAccountId },
      select: {
        id: true,
        platform: true,
        status: true,
        displayName: true,
        proxyId: true,
        deviceProfileId: true,
        postingMethod: true,
        proxy: { select: { id: true, status: true } },
      },
    }),
  ])

  if (!video) {
    throw createError({ statusCode: 404, message: `Video #${videoId} не найдено` })
  }
  if (!account) {
    throw createError({ statusCode: 404, message: `SocialAccount #${socialAccountId} не найден` })
  }
  if (account.platform !== platform) {
    throw createError({
      statusCode: 400,
      message: `Платформа аккаунта (${account.platform}) не совпадает с заявленной (${platform})`,
    })
  }

  // Proxy gating (hard-block): нельзя создать posting job без прокси / с unhealthy прокси.
  // Защита от мгновенного бана при постинге с реального IP оператора.
  if (!account.proxyId) {
    throw createError({
      statusCode: 412,
      statusMessage: "no_proxy",
      message: "Нельзя создать задачу постинга: у аккаунта нет прокси.",
      data: {
        code: "no_proxy",
        accountId: account.id,
        suggestion: "Привяжите рабочий прокси к аккаунту перед созданием задачи постинга.",
      },
    })
  }
  if (account.proxy && account.proxy.status !== "healthy") {
    throw createError({
      statusCode: 412,
      statusMessage: "proxy_unhealthy",
      message: `Прокси аккаунта в статусе "${account.proxy.status}". Постинг запрещён.`,
      data: {
        code: "proxy_unhealthy",
        accountId: account.id,
        proxyId: account.proxy.id,
        proxyStatus: account.proxy.status,
        suggestion: "Проверьте прокси в /proxies, дождитесь статуса healthy.",
      },
    })
  }

  // Очередь PostingJob существует только для browser_automation: воркер
  // (utils/posting/worker.ts) на api-аккаунте терминально падает с
  // ApiPostingUnsupportedError, то есть оператор получал job, который не мог
  // выполниться никогда. Для официального API-аккаунта публикация идёт другим
  // путём — Upload через POST /api/uploads/create. Проверка после proxy-gating:
  // proxy — более жёсткий гейт, его 412 имеет приоритет.
  if (account.postingMethod === "api") {
    throw createError({
      statusCode: 422,
      statusMessage: "api_method_unsupported",
      message:
        `Аккаунт „${account.displayName}" подключён через официальный API (postingMethod=api). `
        + `Для таких аккаунтов публикация идёт через загрузку: POST /api/uploads/create. `
        + `Очередь PostingJob обслуживает только аккаунты с методом „Через браузер" (browser_automation).`,
      data: {
        code: "api_method_unsupported",
        accountId: account.id,
        platform,
        suggestion:
          `Опубликуйте видео через /api/uploads/create либо смените метод постинга аккаунта на „Через браузер" (browser_automation).`,
      },
    })
  }

  // 1:1:1 pre-flight для browser_automation: дружелюбная 409 ДО удара об constraint.
  // api-аккаунты не ограничены (легитимный шеринг прокси).
  if (account.postingMethod === "browser_automation") {
    await assertOneToOneForBrowserAutomation(account.id, {
      proxyId: account.proxyId,
      deviceProfileId: account.deviceProfileId,
    })
  }

  const optionalNumber = (raw: unknown): number | null => {
    if (raw === undefined || raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  // Дефолт попыток по методу аккаунта (browser_automation тяжелее → больше ретраев).
  const maxAttempts = explicitMaxAttempts ?? defaultMaxAttemptsForMethod(account.postingMethod)

  const job = await createPostingJob({
    videoId,
    socialAccountId,
    platform,
    contentSnapshot: contentSnapshot as Prisma.InputJsonValue,
    scheduledAt,
    runId: optionalNumber(body.runId),
    pipelineId: optionalNumber(body.pipelineId),
    uploadId: optionalNumber(body.uploadId),
    maxAttempts,
    createdById: user.id,
  })

  setResponseStatus(event, 201)
  return { data: job }
})
