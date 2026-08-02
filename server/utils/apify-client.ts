/**
 * Клиент для Apify API.
 * Запускает акторов, ожидает результат и маппит данные в тренды.
 */

import type { Prisma } from "../../app/generated/prisma/client"

interface ApifyRunResponse {
  data: {
    id: string
    status: string
  }
}

interface ApifyRunStatusResponse {
  data: {
    id: string
    status: string
    statusMessage?: string
    startedAt?: string
    finishedAt?: string
  }
}

export interface ApifyRunInfo {
  status: string
  statusMessage?: string
  startedAt?: string
  finishedAt?: string
}

interface ApifyProfile {
  appId: number
  keywords: string[]
  platforms: Array<string>
  language?: string | null
  geo?: string | null
}

const POLL_INTERVAL_MS = 10_000
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Конвертирует actorId из формата "owner/name" в "owner~name" для URL path.
 * Apify REST API использует ~ как разделитель в URL, а / интерпретируется как path separator.
 */
function encodeActorId(actorId: string): string {
  return actorId.replace("/", "~")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getApifyToken(): string {
  const apifyToken = process.env.APIFY_TOKEN || ""

  if (!apifyToken) {
    throw createError({
      statusCode: 500,
      message: "APIFY_TOKEN не настроен в .env",
    })
  }

  return apifyToken
}

/**
 * Возвращает base URL для Apify REST API. По умолчанию официальный production
 * endpoint. В тестах можно подменить через ENV `APIFY_BASE_URL` — это позволяет
 * поднять локальный mock-сервер (см. tests/api/_helpers/apify-mock-server.ts)
 * и прогонять happy-path интеграционных тестов без выхода в реальный Apify.
 *
 * Trailing slash отрезается, чтобы конкатенация была безопасной.
 */
export function getApifyBaseUrl(): string {
  const raw = process.env.APIFY_BASE_URL || "https://api.apify.com"
  return raw.replace(/\/+$/, "")
}

/**
 * Низкоуровневый запуск Apify-актора с произвольным body input.
 * Используется и keyword-режимом (через runApifyActor), и profile-режимом
 * (через fetchAccountMetrics → buildProfileScraperInput).
 *
 * Не ломает старую keyword-сигнатуру — обёртка runApifyActor делегирует сюда.
 */
export async function runApifyActorRaw(
  actorId: string,
  body: Record<string, unknown>,
): Promise<string> {
  requirePaidApisEnabled("Apify")

  const token = getApifyToken()

  const response = await $fetch<ApifyRunResponse>(
    `${getApifyBaseUrl()}/v2/acts/${encodeActorId(actorId)}/runs`,
    {
      method: "POST",
      query: { token },
      headers: { "content-type": "application/json" },
      body,
    },
  )

  const runId = response?.data?.id
  if (!runId) {
    throw createError({
      statusCode: 502,
      message: "Apify не вернул runId",
    })
  }

  return runId
}

/**
 * Instagram-скрапер Apify: slug и внутренний id одного и того же актора.
 * Профиль трендвотчера хранит то, что ввёл пользователь, поэтому сверяемся с обоими.
 */
const INSTAGRAM_SCRAPER_IDS = new Set([
  "apify/instagram-scraper",
  "apify~instagram-scraper",
  "shu8hvrxbjby3eb9w",
])

export function isInstagramScraperActor(actorId: string): boolean {
  return INSTAGRAM_SCRAPER_IDS.has(actorId.trim().toLowerCase())
}

/** Что собирать в Instagram: вертикальные Reels или ленту целиком. */
export type ContentFormat = "reels" | "posts"

/**
 * Превращает ключевое слово в Instagram-URL для directUrls.
 *
 * Актор не умеет искать посты по произвольному запросу: режим `search` отдаёт
 * найденные хэштеги и аккаунты, а сами посты — только по прямой ссылке.
 * Поэтому keyword трактуем как адрес: `@user` и ссылка — аккаунт, всё
 * остальное — хэштег.
 */
function instagramKeywordToUrl(keyword: string): string {
  const raw = keyword.trim()

  if (/^https?:\/\//i.test(raw)) return raw

  if (raw.startsWith("@")) {
    return `https://www.instagram.com/${raw.slice(1).toLowerCase()}/`
  }

  // Хэштег не может содержать пробелы и решётку.
  const tag = raw.replace(/^#/, "").replace(/\s+/g, "").toLowerCase()
  return `https://www.instagram.com/explore/tags/${tag}/`
}

/**
 * Строит input актора под его собственный формат.
 *
 * TikTok-скрапер принимает `searchQueries` + `maxItems`, Instagram-скрапер —
 * `directUrls` + `resultsLimit`. Один формат на оба актора не работает:
 * лишние поля Instagram-скрапер игнорирует и возвращает пустой dataset.
 */
export function buildKeywordSearchInput(
  actorId: string,
  input: { keywords: string[]; maxItems?: number; contentFormat?: ContentFormat | null },
): Record<string, unknown> {
  const maxItems = input.maxItems ?? 20

  if (isInstagramScraperActor(actorId)) {
    return {
      directUrls: input.keywords.map(instagramKeywordToUrl),
      // Фабрика производит вертикальные ролики, поэтому в трендах интересны
      // Reels, а не карусели и фото: у последних просмотров нет вовсе.
      resultsType: input.contentFormat === "posts" ? "posts" : "reels",
      resultsLimit: maxItems,
      addParentData: false,
    }
  }

  // resultsPerPage — лимит на один поисковый запрос. Без него актор отдаёт
  // считанные единицы: два слова с maxItems=10 вернули 2 видео вместо 20.
  const perQuery = Math.max(1, Math.ceil(maxItems / Math.max(1, input.keywords.length)))

  return {
    searchQueries: input.keywords,
    maxItems,
    resultsPerPage: perQuery,
  }
}

/**
 * Запускает Apify-актор в keyword-режиме (поиск по запросам) и возвращает runId.
 * Сигнатура зафиксирована — используется существующими call sites
 * (cycle-orchestrator, trendwatcher-runner). Делегирует в runApifyActorRaw.
 */
export async function runApifyActor(
  actorId: string,
  input: { keywords: string[]; maxItems?: number; contentFormat?: ContentFormat | null },
): Promise<string> {
  return runApifyActorRaw(actorId, buildKeywordSearchInput(actorId, input))
}

/**
 * Ожидает завершения Apify run с polling.
 */
export async function waitForApifyRun(
  runId: string,
  timeoutMs?: number,
): Promise<void> {
  const token = getApifyToken()
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const response = await $fetch<ApifyRunStatusResponse>(
      `${getApifyBaseUrl()}/v2/actor-runs/${runId}`,
      { query: { token } },
    )

    const status = response?.data?.status

    if (status === "SUCCEEDED") return
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw createError({
        statusCode: 502,
        message: `Apify run ${runId} завершился со статусом: ${status}`,
      })
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw createError({
    statusCode: 504,
    message: `Apify run ${runId}: таймаут (${timeout / 1000}с)`,
  })
}

/**
 * Получает текущий статус и метаданные Apify run.
 */
export async function getApifyRunInfo(runId: string): Promise<ApifyRunInfo> {
  const token = getApifyToken()
  const response = await $fetch<ApifyRunStatusResponse>(
    `${getApifyBaseUrl()}/v2/actor-runs/${runId}`,
    { query: { token } },
  )
  return {
    status: response?.data?.status ?? "UNKNOWN",
    statusMessage: response?.data?.statusMessage,
    startedAt: response?.data?.startedAt,
    finishedAt: response?.data?.finishedAt,
  }
}

/**
 * Отменяет Apify run через API (abort).
 * Возвращает true если abort успешен, false если не удалось.
 */
export async function abortApifyRun(runId: string): Promise<boolean> {
  try {
    const token = getApifyToken()
    await $fetch(
      `${getApifyBaseUrl()}/v2/actor-runs/${runId}/abort`,
      { method: "POST", query: { token } },
    )
    return true
  } catch {
    return false
  }
}

/**
 * Получает результаты Apify run из dataset.
 */
export async function getApifyResults(runId: string): Promise<unknown[]> {
  const token = getApifyToken()

  const items = await $fetch<unknown[]>(
    `${getApifyBaseUrl()}/v2/actor-runs/${runId}/dataset/items`,
    { query: { token } },
  )

  return Array.isArray(items) ? items : []
}

/**
 * Извлекает URL превью из разных форматов ответа Apify TikTok-скраперов.
 * Разные версии акторов возвращают обложку в разных полях.
 *
 * Экспортируется — переиспользуется в account-metrics-mapper для TikTok-режима.
 */
export function extractThumbnailUrl(item: Record<string, unknown>): string | null {
  // Прямое поле thumbnailUrl
  if (item.thumbnailUrl) return String(item.thumbnailUrl)

  // dynamicCover / originCover (animated/static cover)
  if (item.dynamicCover) return String(item.dynamicCover)
  if (item.originCover) return String(item.originCover)

  // coverUrl (некоторые версии акторов)
  if (item.coverUrl) return String(item.coverUrl)

  // covers — массив URL обложек
  if (Array.isArray(item.covers) && item.covers.length > 0) {
    return String(item.covers[0])
  }

  // videoMeta.coverUrl (clockworks/tiktok-scraper)
  if (item.videoMeta && typeof item.videoMeta === "object") {
    const meta = item.videoMeta as Record<string, unknown>
    if (meta.coverUrl) return String(meta.coverUrl)
    if (meta.originCover) return String(meta.originCover)
    if (meta.dynamicCover) return String(meta.dynamicCover)
  }

  // musicMeta.coverThumb (иногда единственная картинка)
  // — не используем, слишком маленькая и не относится к видео

  return null
}

/**
 * Счётчик публикации: отрицательных значений быть не может.
 * Instagram присылает -1, когда автор скрыл лайки, — в базе это превращалось
 * в тренд с likeCount = -1 и портило сортировку.
 */
function toCount(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

/**
 * Отсеивает элементы, которые постом не являются.
 * На пустом прогоне Apify кладёт в dataset не пустой массив, а одну заглушку
 * вида `{ error: "no_items" }` — без фильтра она приезжала в тренды пустой
 * строкой вместо публикации.
 */
export function isImportableApifyItem(item: Record<string, unknown>): boolean {
  if (item.error) return false
  return Boolean(item.url || item.webVideoUrl || item.shortUrl)
}

/**
 * Достаёт имя автора из разных форматов акторов.
 * TikTok кладёт его в authorMeta.name, Instagram — в ownerFullName,
 * а если полного имени у аккаунта нет, остаётся username.
 */
function extractAuthorName(item: Record<string, unknown>): string | null {
  const meta = item.authorMeta as Record<string, unknown> | undefined
  if (meta?.name) return String(meta.name)
  if (item.author) return String(item.author)
  if (item.ownerFullName) return String(item.ownerFullName)
  if (item.ownerUsername) return String(item.ownerUsername)
  return null
}

/**
 * Маппит элемент Apify-ответа в Prisma TrendCreateInput.
 */
export function mapApifyToTrend(
  item: Record<string, unknown>,
  profile: ApifyProfile,
): Prisma.TrendCreateInput {
  const platform = profile.platforms[0] ?? "tiktok"

  return {
    app: profile.appId ? { connect: { id: profile.appId } } : undefined,
    platform: platform as "tiktok" | "instagram" | "youtube",
    sourceUrl: String(item.url || item.webVideoUrl || item.shortUrl || ""),
    title: String(item.text || item.title || item.caption || "Без названия").slice(0, 500),
    description: item.description ? String(item.description).slice(0, 2000) : null,
    authorName: extractAuthorName(item),
    thumbnailUrl: extractThumbnailUrl(item) ?? (item.displayUrl ? String(item.displayUrl) : null),
    videoUrl: item.videoUrl ? String(item.videoUrl) : null,
    // videoPlayCount/likesCount/commentsCount — Instagram. У Reels
    // videoViewCount приходит бессмысленно маленьким (13 просмотров при 949
    // лайках), поэтому videoPlayCount идёт первым, а не наоборот.
    viewCount: toCount(
      item.playCount || item.viewCount || item.views || item.videoPlayCount || item.videoViewCount || 0,
    ),
    likeCount: toCount(item.diggCount || item.likeCount || item.likes || item.likesCount || 0),
    commentCount: toCount(item.commentCount || item.comments || item.commentsCount || 0),
    hashtags: Array.isArray(item.hashtags)
      ? (item.hashtags as Array<Record<string, unknown>>).map((h) => String(h.name || h)).slice(0, 30)
      : [],
    shareCount: Number(item.shareCount || item.shares || 0),
    publishedAt: item.createTime
      ? new Date(Number(item.createTime) * 1000)
      : (item.publishedAt
        ? new Date(String(item.publishedAt))
        : (item.timestamp ? new Date(String(item.timestamp)) : null)),
    language: profile.language || null,
    geo: profile.geo || null,
    status: "new",
  }
}

/**
 * Маппит элемент Apify-ответа в Prisma TrendCreateInput с привязкой keyword.
 */
export function mapApifyToTrendWithKeyword(
  item: Record<string, unknown>,
  profile: ApifyProfile,
  keyword: string,
): Prisma.TrendCreateInput {
  return {
    ...mapApifyToTrend(item, profile),
    keyword,
  }
}

// --- Preflight Validation ---

export type ApifyValidationErrorCode =
  | "token_missing"
  | "token_invalid_or_forbidden"
  | "actor_not_found"
  | "actor_task_not_found"
  | "source_config_mismatch"
  | "actor_input_invalid"
  | "profile_invalid"
  | "paid_apis_disabled"
  | "network_error"

export interface ApifyValidationResult {
  valid: boolean
  errorCode?: ApifyValidationErrorCode
  errorSummary?: string
  nextAction?: string
  canRetry: boolean
  needsProfileFix: boolean
  actorFound?: boolean
  tokenValid?: boolean
}

/**
 * Валидирует формат actorId.
 * Допустимые форматы: "owner/actor-name" или "owner~actor-name" или plain id.
 */
function isValidActorIdFormat(actorId: string): boolean {
  if (!actorId || actorId.trim().length === 0) return false
  // owner/name or owner~name
  if (/^[\w-]+[/~][\w-]+$/.test(actorId)) return true
  // plain alphanumeric id
  if (/^[\w]+$/.test(actorId)) return true
  return false
}

/**
 * Проверяет доступность Apify-актора через GET /v2/acts/{actorId}.
 * Не запускает actor — только проверяет его существование и доступ.
 */
export async function validateApifyActor(actorId: string): Promise<ApifyValidationResult> {
  // Check paid APIs
  try {
    requirePaidApisEnabled("Apify")
  } catch {
    return {
      valid: false,
      errorCode: "paid_apis_disabled",
      errorSummary: "Платные API отключены — Apify заблокирован",
      nextAction: "Установите ENABLE_PAID_APIS=true в .env",
      canRetry: false,
      needsProfileFix: false,
    }
  }

  // Check format
  if (!isValidActorIdFormat(actorId)) {
    return {
      valid: false,
      errorCode: "profile_invalid",
      errorSummary: `Некорректный формат actorId: "${actorId}"`,
      nextAction: "Укажите actorId в формате owner/actor-name",
      canRetry: false,
      needsProfileFix: true,
    }
  }

  // Check token
  let token: string
  try {
    token = getApifyToken()
  } catch {
    return {
      valid: false,
      errorCode: "token_missing",
      errorSummary: "APIFY_TOKEN не настроен",
      nextAction: "Добавьте APIFY_TOKEN в .env",
      canRetry: false,
      needsProfileFix: false,
      tokenValid: false,
    }
  }

  // Check actor exists via GET /v2/acts/{actorId}
  try {
    await $fetch(
      `${getApifyBaseUrl()}/v2/acts/${encodeActorId(actorId)}`,
      { query: { token } },
    )
    return {
      valid: true,
      canRetry: true,
      needsProfileFix: false,
      actorFound: true,
      tokenValid: true,
    }
  } catch (err: unknown) {
    const status = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { statusCode?: number; status?: number })?.status
      ?? (err as { response?: { status?: number } })?.response?.status

    if (status === 404) {
      return {
        valid: false,
        errorCode: "actor_not_found",
        errorSummary: `Актор "${actorId}" не найден в Apify`,
        nextAction: "Проверьте slug актора на apify.com и обновите профиль",
        canRetry: false,
        needsProfileFix: true,
        actorFound: false,
        tokenValid: true,
      }
    }

    if (status === 401 || status === 403) {
      return {
        valid: false,
        errorCode: "token_invalid_or_forbidden",
        errorSummary: `Нет доступа к актору "${actorId}" — проверьте API-токен и права`,
        nextAction: "Проверьте APIFY_TOKEN и доступ к актору в Apify Console",
        canRetry: false,
        needsProfileFix: false,
        actorFound: undefined,
        tokenValid: false,
      }
    }

    return {
      valid: false,
      errorCode: "network_error",
      errorSummary: `Ошибка проверки актора: ${err instanceof Error ? err.message : "unknown"}`,
      nextAction: "Повторите попытку позже",
      canRetry: true,
      needsProfileFix: false,
    }
  }
}

/**
 * Полная preflight-валидация профиля перед запуском.
 * Проверяет: формат, token, наличие актора, обязательные поля.
 */
export async function preflightValidateProfile(profile: {
  actorId: string
  keywords: string[]
  enabled: boolean
  maxItems?: number
}): Promise<ApifyValidationResult> {
  if (!profile.enabled) {
    return {
      valid: false,
      errorCode: "profile_invalid",
      errorSummary: "Профиль отключён",
      nextAction: "Включите профиль перед запуском",
      canRetry: false,
      needsProfileFix: true,
    }
  }

  if (!profile.keywords || profile.keywords.length === 0) {
    return {
      valid: false,
      errorCode: "actor_input_invalid",
      errorSummary: "Профиль не содержит ключевых слов",
      nextAction: "Добавьте ключевые слова в профиль",
      canRetry: false,
      needsProfileFix: true,
    }
  }

  return validateApifyActor(profile.actorId)
}

// --- Profile-режим (Account Metrics, Часть C) ----------------------------------
//
// Profile-режим вызывается из POST /api/accounts/:id/metrics/fetch и собирает
// метрики по @handle (а не по keywords). Используется другой пул акторов и
// другая форма input. См. resolveProfileActor + buildProfileScraperInput.

import type { AccountMetricsResult, MetricsPlatform } from "../../shared/types/account-metrics"

/**
 * Дефолтные акторы для profile-режима. Переопределяются через .env
 * (APIFY_PROFILE_ACTOR_TIKTOK / _IG / _YT) при необходимости.
 */
export const PROFILE_ACTORS: Record<MetricsPlatform, string> = {
  tiktok: "clockworks/tiktok-scraper",
  instagram: "apify/instagram-profile-scraper",
  youtube: "streamers/youtube-channel-scraper",
}

/**
 * Резолвит actorId с учётом ENV-override.
 */
export function resolveProfileActor(platform: MetricsPlatform): string {
  const envMap: Record<MetricsPlatform, string | undefined> = {
    tiktok: process.env.APIFY_PROFILE_ACTOR_TIKTOK,
    instagram: process.env.APIFY_PROFILE_ACTOR_IG,
    youtube: process.env.APIFY_PROFILE_ACTOR_YT,
  }
  return envMap[platform] || PROFILE_ACTORS[platform]
}

/**
 * Строит body input для profile-scraper'а конкретной платформы.
 * Handle нормализуется — лидирующий '@' отрезается на всякий случай.
 */
export function buildProfileScraperInput(
  platform: MetricsPlatform,
  handle: string,
): Record<string, unknown> {
  const normalized = handle.replace(/^@/, "")
  switch (platform) {
    case "tiktok":
      return {
        profiles: [normalized],
        resultsPerPage: 30,
        shouldDownloadVideos: false,
      }
    case "instagram":
      return {
        usernames: [normalized],
        resultsLimit: 30,
        addParentData: true,
      }
    case "youtube":
      return {
        startUrls: [{ url: `https://youtube.com/@${normalized}/videos` }],
        maxResults: 30,
      }
  }
}

/**
 * Высокоуровневый запуск profile-режима: actor → wait → results → mapper.
 * Возвращает AccountMetricsResult — нормализованный для записи в snapshot.
 *
 * Mapper вынесен в server/utils/account-metrics-mapper.ts.
 */
export async function fetchAccountMetrics(
  // reserved for future pipeline-node integration (agentRunId binding)
  _appId: number,
  platform: MetricsPlatform,
  handle: string,
  // reserved for future pipeline-node integration (agentRunId binding)
  _agentRunId?: number,
): Promise<AccountMetricsResult> {
  const actorId = resolveProfileActor(platform)
  const input = buildProfileScraperInput(platform, handle)

  const runId = await runApifyActorRaw(actorId, input)
  await waitForApifyRun(runId, DEFAULT_TIMEOUT_MS)
  const items = await getApifyResults(runId)

  if (items.length === 0) {
    return {
      followers: null,
      following: null,
      totalViews: null,
      totalLikes: null,
      totalComments: null,
      postsCount: null,
      avgViewsPer30d: null,
      engagementRate: null,
      bio: null,
      avatarUrl: null,
      isVerified: null,
      sampleSize: 0,
      posts: [],
      status: "error",
      errorMessage: `Apify вернул пустой результат для @${handle} — handle не существует, профиль приватный, или scraper не нашёл данных`,
    }
  }

  // Импорт через require — статический импорт mapper'а вверху ввёл бы циклическую
  // зависимость (mapper использует extractThumbnailUrl из этого же файла).
  // Импортируем по требованию.
  const { mapApifyToAccountMetrics } = await import("./account-metrics-mapper")
  return mapApifyToAccountMetrics(items, platform)
}
