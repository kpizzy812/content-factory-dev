import { readFile, stat } from "node:fs/promises"
import type { DecryptedAccount, MetricsResult, SocialPlatformAdapter, UploadParams, UploadResult } from "./types"

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
const TIKTOK_UPLOAD_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
const TIKTOK_UPLOAD_URL = "https://open.tiktokapis.com/v2/post/publish/video/"
const TIKTOK_VIDEO_QUERY_URL = "https://open.tiktokapis.com/v2/video/query/"

/**
 * Обновляет access token через refresh token.
 */
async function refreshAccessToken(account: DecryptedAccount): Promise<string> {
  if (!account.refreshToken) {
    throw new Error(`TikTok аккаунт ${account.displayName}: отсутствует refresh token`)
  }

  const response = await $fetch<{
    access_token: string
    expires_in: number
    refresh_token: string
  }>(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }).toString(),
  })

  const newExpiresAt = new Date(Date.now() + response.expires_in * 1000)
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encrypt(response.access_token),
      refreshToken: encrypt(response.refresh_token),
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
      `TikTok аккаунт ${account.displayName}: создан вручную (manual), OAuth-токены отсутствуют. ` +
        `Публикация и сбор метрик через TikTok API недоступны — используйте Indigo browser automation.`,
    )
  }

  const isExpired = account.expiresAt && account.expiresAt.getTime() < Date.now() + 60_000

  if (isExpired || !account.accessToken) {
    return refreshAccessToken(account)
  }

  return account.accessToken
}

/**
 * TikTok Content Posting API адаптер.
 * Использует Upload to Inbox flow: init -> upload chunks -> publish.
 */
export const tiktokAdapter: SocialPlatformAdapter = {
  async uploadVideo(account: DecryptedAccount, params: UploadParams): Promise<UploadResult> {
    const accessToken = await getValidAccessToken(account)

    const fileStat = await stat(params.filePath)
    const fileSize = fileStat.size

    // 1. Инициализация загрузки
    const initResponse = await $fetch<{
      data: { publish_id: string; upload_url: string }
    }>(TIKTOK_UPLOAD_INIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: {
        source_info: {
          source: "FILE_UPLOAD",
          video_size: fileSize,
          chunk_size: fileSize,
          total_chunk_count: 1,
        },
      },
    })

    const { publish_id, upload_url } = initResponse.data

    // 2. Загрузка видеофайла
    const fileBuffer = await readFile(params.filePath)

    await $fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes 0-${fileSize - 1}/${fileSize}`,
      },
      body: fileBuffer,
    })

    // 3. Публикация
    const description = [
      params.title,
      params.description || "",
      params.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "),
    ].filter(Boolean).join("\n").trim()

    await $fetch(TIKTOK_UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: {
        publish_id,
        post_info: {
          title: params.title.slice(0, 150),
          description: description.slice(0, 2200),
          disable_comment: false,
          privacy_level: "PUBLIC_TO_EVERYONE",
        },
      },
    })

    return {
      platformPostId: publish_id,
      platformPostUrl: `https://www.tiktok.com/@${account.platformUserId || "user"}/video/${publish_id}`,
    }
  },

  async getPostMetrics(account: DecryptedAccount, platformPostId: string): Promise<MetricsResult> {
    const accessToken = await getValidAccessToken(account)

    const response = await $fetch<{
      data: {
        videos: Array<{
          view_count: number
          like_count: number
          comment_count: number
          share_count: number
        }>
      }
    }>(TIKTOK_VIDEO_QUERY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: {
        filters: { video_ids: [platformPostId] },
      },
    })

    const video = response.data?.videos?.[0]
    if (!video) {
      throw new Error(`TikTok: видео ${platformPostId} не найдено`)
    }

    return {
      views: video.view_count || 0,
      likes: video.like_count || 0,
      comments: video.comment_count || 0,
      shares: video.share_count || 0,
      watchThrough: 0,
      ctr: 0,
      followerGain: 0,
    }
  },
}
