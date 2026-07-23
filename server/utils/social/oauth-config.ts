/**
 * Конфигурация OAuth для каждой платформы.
 */

interface OAuthConfig {
  authUrl: string
  tokenUrl: string
  scopes: string[]
  getClientId: () => string
  getClientSecret: () => string
}

export function getOAuthConfig(platform: string): OAuthConfig {
  const configs: Record<string, OAuthConfig> = {
    youtube: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
      ],
      getClientId: () => process.env.YOUTUBE_CLIENT_ID || "",
      getClientSecret: () => process.env.YOUTUBE_CLIENT_SECRET || "",
    },
    tiktok: {
      authUrl: "https://www.tiktok.com/v2/auth/authorize/",
      tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
      scopes: ["user.info.basic", "video.publish", "video.upload"],
      getClientId: () => process.env.TIKTOK_CLIENT_KEY || "",
      getClientSecret: () => process.env.TIKTOK_CLIENT_SECRET || "",
    },
    instagram: {
      authUrl: "https://www.instagram.com/oauth/authorize",
      tokenUrl: "https://api.instagram.com/oauth/access_token",
      scopes: [
        "instagram_business_basic",
        "instagram_business_content_publish",
        "instagram_business_manage_insights",
      ],
      getClientId: () => process.env.INSTAGRAM_APP_ID || "",
      getClientSecret: () => process.env.INSTAGRAM_APP_SECRET || "",
    },
  }

  const oauthConfig = configs[platform]
  if (!oauthConfig) {
    throw createError({
      statusCode: 400,
      message: `OAuth не настроен для платформы: ${platform}`,
    })
  }

  return oauthConfig
}

const VALID_PLATFORMS = ["youtube", "tiktok", "instagram"] as const

export function validatePlatform(platform: string): string {
  if (!VALID_PLATFORMS.includes(platform as typeof VALID_PLATFORMS[number])) {
    throw createError({
      statusCode: 400,
      message: `Неподдерживаемая платформа: ${platform}. Доступные: ${VALID_PLATFORMS.join(", ")}`,
    })
  }
  return platform
}
