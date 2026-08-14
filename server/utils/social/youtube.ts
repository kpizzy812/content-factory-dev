import { readFile } from "node:fs/promises"
import { buildAiDisclosure } from "./ai-disclosure"
import type { FollowerCount, FollowerCountProvider } from "./follower-count"
import { PostUnavailableError } from "./post-availability"
import type {
  DecryptedAccount,
  MetricsContext,
  MetricsResult,
  SocialPlatformAdapter,
  UploadParams,
  UploadResult,
} from "./types"

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
const YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"

/**
 * Обновляет access token через refresh token.
 */
async function refreshAccessToken(account: DecryptedAccount): Promise<string> {
  if (!account.refreshToken) {
    throw new Error(`YouTube аккаунт ${account.displayName}: отсутствует refresh token`)
  }

  const response = await $fetch<{ access_token: string; expires_in: number }>(GOOGLE_TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID || "",
      client_secret: process.env.YOUTUBE_CLIENT_SECRET || "",
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  })

  // Обновить токен и срок действия в БД
  const newExpiresAt = new Date(Date.now() + response.expires_in * 1000)
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encrypt(response.access_token),
      expiresAt: newExpiresAt,
    },
  })

  return response.access_token
}

/**
 * Получает актуальный access token, обновляя при необходимости.
 */
async function getValidAccessToken(account: DecryptedAccount): Promise<string> {
  if (!account.accessToken && !account.refreshToken) {
    throw new Error(
      // Совет про Indigo browser automation отсюда убран намеренно: это
      // унаследованный контур, запрещённый в основном пути (PROJECT_CONTEXT §4).
      // Из белого адаптера остаётся ровно одно законное действие — OAuth.
      `YouTube аккаунт ${account.displayName}: создан вручную (manual), OAuth-токены отсутствуют. ` +
        `Публикация и сбор метрик через YouTube API недоступны — подключите аккаунт ` +
        `через официальный OAuth Google (или переподключите, если доступ был отозван).`,
    )
  }

  const isExpired = account.expiresAt && account.expiresAt.getTime() < Date.now() + 60_000

  if (isExpired || !account.accessToken) {
    return refreshAccessToken(account)
  }

  return account.accessToken
}

/** Лимиты YouTube Data API: превышение любого из них — отказ 400 на init. */
const YOUTUBE_TITLE_LIMIT = 100
const YOUTUBE_DESCRIPTION_LIMIT = 5_000
const YOUTUBE_TAGS_TOTAL_LIMIT = 500

export interface YouTubeSnippet {
  title: string
  description: string
  tags: string[]
}

/**
 * Собирает snippet под лимиты YouTube.
 *
 * Заголовок: угловые скобки платформа запрещает, перевод строки в title тоже
 * (это одна строка), длина — 100 символов. Теги идут без решёток: в поле tags
 * решётка считается частью тега и ломает поиск, а суммарная длина ограничена.
 */
export function buildYouTubeSnippet(params: UploadParams): YouTubeSnippet {
  const title = params.title
    .replace(/[<>]/g, "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim()
    .slice(0, YOUTUBE_TITLE_LIMIT)

  const hashtags = params.hashtags
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => (value.startsWith("#") ? value : `#${value}`))

  const parts = [(params.description || "").trim()]
  // #Shorts в описании — сигнал платформе, что ролик вертикальный.
  if (params.isShort && !parts[0]!.includes("#Shorts")) parts.push("#Shorts")
  if (hashtags.length > 0) parts.push(hashtags.join(" "))
  const description = parts
    .filter(Boolean)
    .join("\n")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, YOUTUBE_DESCRIPTION_LIMIT)

  const tags: string[] = []
  let tagsLength = 0
  for (const raw of params.hashtags) {
    const tag = raw.replace(/#/g, "").trim()
    if (!tag) continue
    // Лимит считается по сумме длин тегов — что не влезло, просто не отправляем.
    if (tagsLength + tag.length > YOUTUBE_TAGS_TOTAL_LIMIT) break
    tags.push(tag)
    tagsLength += tag.length
  }

  return { title, description, tags }
}

/**
 * YouTube Data API v3 адаптер.
 * Загружает видео через resumable upload.
 */
export const youtubeAdapter: SocialPlatformAdapter & FollowerCountProvider = {
  async uploadVideo(account: DecryptedAccount, params: UploadParams): Promise<UploadResult> {
    const accessToken = await getValidAccessToken(account)

    const snippet = buildYouTubeSnippet(params)

    // 1. Инициализация resumable upload
    const initResponse = await $fetch.raw(`${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
      },
      body: {
        snippet,
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
          // Раскрытие синтетического контента (EU AI Act, политика YouTube об
          // altered or synthetic content). Наши ролики синтетические по
          // построению: речь синтезирована, кадры сгенерированы.
          ...buildAiDisclosure("youtube", params.isAiGenerated ?? true),
        },
      },
    })

    const uploadUrl = initResponse.headers.get("location")
    if (!uploadUrl) {
      throw new Error("YouTube: не получен URL для загрузки (resumable upload)")
    }

    // 2. Загрузка файла.
    // Читаем буфером, а не потоком: undici требует у стримового тела duplex:
    // "half", иначе PUT падает ещё до отправки байтов.
    const fileBuffer = await readFile(params.filePath)

    const uploadResponse = await $fetch<{ id: string }>(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "video/mp4",
        "Content-Length": String(fileBuffer.byteLength),
      },
      body: fileBuffer,
    })

    if (!uploadResponse.id) {
      throw new Error("YouTube: не получен ID загруженного видео")
    }

    const videoUrl = params.isShort
      ? `https://youtube.com/shorts/${uploadResponse.id}`
      : `https://youtube.com/watch?v=${uploadResponse.id}`

    return {
      platformPostId: uploadResponse.id,
      platformPostUrl: videoUrl,
    }
  },

  async getPostMetrics(
    account: DecryptedAccount,
    platformPostId: string,
    _context?: MetricsContext,
  ): Promise<MetricsResult> {
    const accessToken = await getValidAccessToken(account)

    // part=status запрашиваем вместе со статистикой: без него отказ площадки
    // (ролик снят по жалобе) неотличим от живого поста с нулевыми просмотрами.
    const response = await $fetch<{
      items: Array<{
        statistics?: {
          viewCount: string
          likeCount: string
          commentCount: string
          favoriteCount: string
        }
        status?: {
          uploadStatus?: string
          rejectionReason?: string
        }
      }>
    }>(`${YOUTUBE_VIDEOS_URL}?part=statistics,status&id=${platformPostId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    const item = response.items?.[0]
    if (!item) {
      // videos.list отвечает HTTP 200 и пустым items только когда ролика по id
      // не существует: временные беды приходят кодами 4xx/5xx и падают выше.
      // Значит это не ошибка сбора, а факт — пост удалён с площадки.
      throw new PostUnavailableError(
        "deleted",
        `YouTube: видео ${platformPostId} отсутствует на площадке — публикация помечена удалённой`,
      )
    }

    if (item.status?.uploadStatus === "rejected") {
      // Отклонённый ролик недоступен зрителям; его счётчики (если они вообще
      // придут) описывают то, чего в ленте нет.
      throw new PostUnavailableError(
        "blocked",
        `YouTube: видео ${platformPostId} отклонено площадкой `
          + `(причина: ${item.status.rejectionReason || "не указана"})`,
      )
    }

    const stats = item.statistics
    if (!stats) {
      // Ответ без запрошенного part=statistics — наша проблема с запросом или
      // правами. Ноль здесь был бы выдуманным числом, поэтому явная ошибка.
      throw new Error(
        `YouTube: в ответе по видео ${platformPostId} нет блока statistics — `
          + `счётчики не измерены, переподключите аккаунт через OAuth`,
      )
    }
    return {
      views: Number(stats.viewCount) || 0,
      likes: Number(stats.likeCount) || 0,
      comments: Number(stats.commentCount) || 0,
      // Репостов YouTube Data API не отдаёт вовсе — это «не измерено», а не ноль.
      // Без пометки в unsupported дашборд рисовал бы «0 репостов» по всем
      // YouTube-роликам как измеренную величину.
      shares: 0,
      // Досматриваемость живёт в YouTube Analytics API (отдельный scope
      // yt-analytics.readonly), которого у наших токенов нет — это «не измерено».
      watchThrough: 0,
      ctr: 0,
      followerGain: 0,
      unsupported: ["watchThrough", "shares"],
    }
  },

  /**
   * Подписчики канала из YouTube Data API (`channels.list`, part=statistics).
   *
   * `mine=true`, а не id канала: наш токен выдан владельцу канала, отдельного
   * поля с channelId у SocialAccount нет, и лишний запрос за ним не нужен.
   * Стоимость — 1 единица квоты, то есть на фоне суточных 10 000 замер
   * подписчиков раз в несколько часов не заметен.
   *
   * Важно про точность: YouTube округляет subscriberCount до трёх значащих
   * цифр у каналов крупнее тысячи подписчиков. Для канала на 12 300 шаг
   * счётчика — сто человек, и мелкий прирост в замер просто не попадёт. Это
   * ограничение площадки, а не наше округление; занижение честнее выдумки.
   */
  async getFollowerCount(account: DecryptedAccount): Promise<FollowerCount> {
    const accessToken = await getValidAccessToken(account)

    const response = await $fetch<{
      items?: Array<{
        statistics?: {
          subscriberCount?: string
          hiddenSubscriberCount?: boolean
          videoCount?: string
        }
      }>
    }>(`${YOUTUBE_CHANNELS_URL}?part=statistics&mine=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    const stats = response.items?.[0]?.statistics
    if (!stats) {
      throw new Error(
        `YouTube аккаунт ${account.displayName}: channels.list не вернул статистику канала — `
          + `переподключите аккаунт через официальный OAuth Google`,
      )
    }
    if (stats.hiddenSubscriberCount) {
      // Канал сам скрыл счётчик. Ноль здесь стал бы «у канала нет подписчиков»
      // и обнулил бы весь прирост по его роликам.
      throw new Error(
        `YouTube аккаунт ${account.displayName}: счётчик подписчиков скрыт настройками канала — `
          + `прирост подписчиков не измеряется`,
      )
    }
    const subscribers = Number(stats.subscriberCount)
    if (!Number.isFinite(subscribers)) {
      throw new Error(
        `YouTube аккаунт ${account.displayName}: subscriberCount отсутствует в ответе площадки`,
      )
    }
    const videos = Number(stats.videoCount)
    return {
      followers: subscribers,
      postsCount: Number.isFinite(videos) ? videos : null,
    }
  },
}
