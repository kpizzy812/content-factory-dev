/**
 * Mapper Apify profile-scraper output → AccountMetricsResult.
 *
 * Поддерживает 3 платформы: TikTok / Instagram / YouTube. Каждая платформа
 * имеет свой actor с уникальной shape, поэтому 3 отдельные функции.
 *
 * Runtime guard: всё обёрнуто в try/catch. Если shape сломается на real-run
 * (часто меняется между версиями actor'а), вернём status='error' + rawSample
 * для post-mortem диагностики, но не упадём с unhandled exception.
 */
import { extractThumbnailUrl } from "./apify-client"
import type {
  AccountMetricsResult,
  MetricsPlatform,
  NormalizedPost,
} from "../../shared/types/account-metrics"

/**
 * Безопасное приведение к bigint. Null/undefined/NaN/отрицательные → null.
 * Дробные числа округляются вниз через Math.floor.
 */
function toBigInt(value: unknown): bigint | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return BigInt(Math.floor(n))
}

/**
 * Engagement rate = (likes + comments) / views по всей выборке постов.
 * Защита от деления на 0 — возвращает null если sumViews=0.
 * Clamp 0..1 защищает от аномальных данных scraper'а.
 */
function calcEngagementRate(posts: NormalizedPost[]): number | null {
  if (posts.length === 0) return null
  let sumViews = 0
  let sumLikes = 0
  let sumComments = 0
  for (const p of posts) {
    sumViews += p.viewCount
    sumLikes += p.likeCount
    sumComments += p.commentCount
  }
  if (sumViews === 0) return null
  const rate = (sumLikes + sumComments) / sumViews
  return Math.min(1, Math.max(0, rate))
}

/**
 * Средние просмотры за последние 30 дней по постам выборки.
 * Если ни один пост не попадает в окно (publishedAt отсутствует или старше) — null.
 */
function calcAvgViewsPer30d(posts: NormalizedPost[]): bigint | null {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recent = posts.filter(
    (p) => p.publishedAt && new Date(p.publishedAt).getTime() > cutoff,
  )
  if (recent.length === 0) return null
  const avg = recent.reduce((s, p) => s + p.viewCount, 0) / recent.length
  return BigInt(Math.floor(avg))
}

/**
 * Пустой error-результат с понятным сообщением. Используется и при пустом input,
 * и в runtime catch'е mapper'а.
 */
function errorResult(
  message: string,
  rawSample?: unknown,
): AccountMetricsResult {
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
    errorMessage: message,
    rawSample,
  }
}

// --- TikTok (clockworks/tiktok-scraper) ----------------------------------------
//
// Output: items[] = записи постов. Каждый пост содержит embedded authorMeta
// со снапшотом профиля (дублируется в каждом item). Берём из первого item.
function mapTikTokMetrics(items: Record<string, unknown>[]): AccountMetricsResult {
  const first = items[0]
  const authorMeta = (first?.authorMeta || {}) as Record<string, unknown>

  const posts: NormalizedPost[] = items.map((item) => ({
    id: String(item.id || item.webVideoUrl || ""),
    url: String(item.webVideoUrl || item.url || ""),
    thumbnailUrl: extractThumbnailUrl(item),
    viewCount: Number(item.playCount || 0),
    likeCount: Number(item.diggCount || 0),
    commentCount: Number(item.commentCount || 0),
    shareCount: Number(item.shareCount || 0),
    publishedAt: item.createTime
      ? new Date(Number(item.createTime) * 1000).toISOString()
      : null,
    title: item.text ? String(item.text).slice(0, 200) : null,
  }))

  return {
    followers: toBigInt(authorMeta.fans),
    following: toBigInt(authorMeta.following),
    totalLikes: toBigInt(authorMeta.heart),
    // TikTok не отдаёт lifetime views на профиль — null
    totalViews: null,
    totalComments: null,
    postsCount: Number(authorMeta.videoCount) || posts.length,
    avgViewsPer30d: calcAvgViewsPer30d(posts),
    engagementRate: calcEngagementRate(posts),
    bio: authorMeta.signature ? String(authorMeta.signature) : null,
    avatarUrl: authorMeta.avatar ? String(authorMeta.avatar) : null,
    isVerified: Boolean(authorMeta.verified),
    sampleSize: posts.length,
    posts,
    status: "ok",
  }
}

// --- Instagram (apify/instagram-profile-scraper) -------------------------------
//
// Output: items[0] = profile-объект. Посты в profile.latestPosts[].
function mapInstagramMetrics(
  items: Record<string, unknown>[],
): AccountMetricsResult {
  const profile = items[0] || {}
  const latestPosts = Array.isArray(profile.latestPosts)
    ? (profile.latestPosts as Record<string, unknown>[])
    : []

  const posts: NormalizedPost[] = latestPosts.map((p) => ({
    id: String(p.id || p.shortCode || ""),
    url: String(p.url || ""),
    thumbnailUrl: p.displayUrl ? String(p.displayUrl) : null,
    viewCount: Number(p.videoViewCount || p.videoPlayCount || 0),
    likeCount: Number(p.likesCount || 0),
    commentCount: Number(p.commentsCount || 0),
    publishedAt: p.timestamp ? new Date(String(p.timestamp)).toISOString() : null,
    title: p.caption ? String(p.caption).slice(0, 200) : null,
  }))

  return {
    followers: toBigInt(profile.followersCount),
    following: toBigInt(profile.followsCount),
    // IG не отдаёт lifetime агрегаты — null
    totalViews: null,
    totalLikes: null,
    totalComments: null,
    postsCount: Number(profile.postsCount) || posts.length,
    avgViewsPer30d: calcAvgViewsPer30d(posts),
    engagementRate: calcEngagementRate(posts),
    bio: profile.biography ? String(profile.biography) : null,
    avatarUrl: profile.profilePicUrl ? String(profile.profilePicUrl) : null,
    isVerified: Boolean(profile.verified),
    sampleSize: posts.length,
    posts,
    status: "ok",
  }
}

// --- YouTube (streamers/youtube-channel-scraper) -------------------------------
//
// Output этого actor'а нестабилен между версиями. Возможные варианты shape:
//   (a) items[0].channel + items[0].videos[] (legacy)
//   (b) items[0] = channel record, items[1..] = video records (current)
// Mapper'у нужно работать в обоих случаях. Если shape совсем не подошёл,
// поможет runtime catch (см. mapApifyToAccountMetrics).
function mapYouTubeMetrics(items: Record<string, unknown>[]): AccountMetricsResult {
  // Ищем "channel"-объект: либо item.channel (variant a), либо первый item (variant b)
  const channelItem =
    items.find((i) => i.channel || i.channelName || i.subscriberCount) || items[0] || {}
  const channel = (channelItem.channel || channelItem) as Record<string, unknown>

  // Видео: либо channel.videos[] (variant a), либо item'ы где есть viewCount/publishDate (variant b)
  let rawVideos: Record<string, unknown>[] = []
  if (Array.isArray(channelItem.videos)) {
    rawVideos = channelItem.videos as Record<string, unknown>[]
  } else {
    rawVideos = items.filter(
      (i) => i.viewCount !== undefined || i.publishDate !== undefined,
    ) as Record<string, unknown>[]
  }

  const posts: NormalizedPost[] = rawVideos.map((v) => {
    let thumb: string | null = null
    if (v.thumbnailUrl) {
      thumb = String(v.thumbnailUrl)
    } else if (Array.isArray(v.thumbnails) && v.thumbnails.length > 0) {
      const t0 = v.thumbnails[0] as Record<string, unknown>
      thumb = t0?.url ? String(t0.url) : null
    }
    return {
      id: String(v.id || v.videoId || v.url || ""),
      url: String(v.url || ""),
      thumbnailUrl: thumb,
      viewCount: Number(v.viewCount || 0),
      likeCount: Number(v.likeCount || 0),
      commentCount: Number(v.commentCount || 0),
      publishedAt: v.publishDate
        ? new Date(String(v.publishDate)).toISOString()
        : v.publishedAt
          ? new Date(String(v.publishedAt)).toISOString()
          : null,
      title: v.title ? String(v.title).slice(0, 200) : null,
    }
  })

  const avatar =
    channel.avatar || channel.thumbnailUrl
      ? String(channel.avatar || channel.thumbnailUrl)
      : null

  return {
    followers: toBigInt(channel.subscriberCount || channel.numberOfSubscribers),
    // YouTube не имеет понятия "following"
    following: null,
    totalViews: toBigInt(channel.viewCount || channel.totalViews),
    totalLikes: null,
    totalComments: null,
    postsCount: Number(channel.videoCount || channel.videosCount) || posts.length,
    avgViewsPer30d: calcAvgViewsPer30d(posts),
    engagementRate: calcEngagementRate(posts),
    bio: channel.description ? String(channel.description) : null,
    avatarUrl: avatar,
    isVerified: Boolean(channel.isVerified),
    sampleSize: posts.length,
    posts,
    status: "ok",
  }
}

/**
 * Главная функция mapper'а. Diспатчит по платформе и оборачивает в runtime guard.
 *
 * При любом throw'е возвращает status='error' + rawSample[0] для диагностики.
 * Это позволяет даже сломанный actor output сохранить в snapshot и показать
 * оператору через AccountDiagnosticPanel.
 */
export function mapApifyToAccountMetrics(
  items: unknown[],
  platform: MetricsPlatform,
): AccountMetricsResult {
  if (!Array.isArray(items) || items.length === 0) {
    return errorResult(
      `Apify вернул пустой массив для платформы ${platform} — handle не найден или приватный`,
    )
  }

  try {
    switch (platform) {
      case "tiktok":
        return mapTikTokMetrics(items as Record<string, unknown>[])
      case "instagram":
        return mapInstagramMetrics(items as Record<string, unknown>[])
      case "youtube":
        return mapYouTubeMetrics(items as Record<string, unknown>[])
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "неизвестная ошибка"
    return errorResult(
      `Mapper упал на платформе ${platform}: ${message}`,
      items[0],
    )
  }
}
