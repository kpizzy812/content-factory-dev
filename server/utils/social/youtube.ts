import { createReadStream, statSync } from "node:fs"
import type { DecryptedAccount, MetricsResult, SocialPlatformAdapter, UploadParams, UploadResult } from "./types"

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"

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
      `YouTube аккаунт ${account.displayName}: создан вручную (manual), OAuth-токены отсутствуют. ` +
        `Публикация и сбор метрик через YouTube API недоступны — используйте Indigo browser automation.`,
    )
  }

  const isExpired = account.expiresAt && account.expiresAt.getTime() < Date.now() + 60_000

  if (isExpired || !account.accessToken) {
    return refreshAccessToken(account)
  }

  return account.accessToken
}

/**
 * YouTube Data API v3 адаптер.
 * Загружает видео через resumable upload.
 */
export const youtubeAdapter: SocialPlatformAdapter = {
  async uploadVideo(account: DecryptedAccount, params: UploadParams): Promise<UploadResult> {
    const accessToken = await getValidAccessToken(account)

    // Подготовка description: добавить #Shorts для вертикальных видео
    let description = params.description || ""
    if (params.isShort && !description.includes("#Shorts")) {
      description = `${description}\n#Shorts`.trim()
    }

    // Добавить хэштеги в описание
    if (params.hashtags.length > 0) {
      const hashtagStr = params.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")
      description = `${description}\n${hashtagStr}`.trim()
    }

    // 1. Инициализация resumable upload
    const initResponse = await $fetch.raw(`${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
      },
      body: {
        snippet: {
          title: params.title,
          description,
          tags: params.hashtags.map((h) => h.replace("#", "")),
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      },
    })

    const uploadUrl = initResponse.headers.get("location")
    if (!uploadUrl) {
      throw new Error("YouTube: не получен URL для загрузки (resumable upload)")
    }

    // 2. Загрузка файла
    const fileStat = statSync(params.filePath)
    const fileStream = createReadStream(params.filePath)

    const uploadResponse = await $fetch<{ id: string }>(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "video/mp4",
        "Content-Length": fileStat.size.toString(),
      },
      body: fileStream as unknown as BodyInit,
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

  async getPostMetrics(account: DecryptedAccount, platformPostId: string): Promise<MetricsResult> {
    const accessToken = await getValidAccessToken(account)

    const response = await $fetch<{
      items: Array<{
        statistics: {
          viewCount: string
          likeCount: string
          commentCount: string
          favoriteCount: string
        }
      }>
    }>(`${YOUTUBE_VIDEOS_URL}?part=statistics&id=${platformPostId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    const item = response.items?.[0]
    if (!item) {
      throw new Error(`YouTube: видео ${platformPostId} не найдено`)
    }

    const stats = item.statistics
    return {
      views: Number(stats.viewCount) || 0,
      likes: Number(stats.likeCount) || 0,
      comments: Number(stats.commentCount) || 0,
      shares: 0,
      watchThrough: 0,
      ctr: 0,
      followerGain: 0,
    }
  },
}
