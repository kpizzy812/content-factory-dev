import type { SocialPlatformAdapter } from "./types"
import { youtubeAdapter } from "./youtube"
import { tiktokAdapter } from "./tiktok"
import { instagramAdapter } from "./instagram"

const adapters: Record<string, SocialPlatformAdapter> = {
  youtube: youtubeAdapter,
  tiktok: tiktokAdapter,
  instagram: instagramAdapter,
}

/**
 * Возвращает адаптер для указанной социальной платформы.
 */
export function getSocialAdapter(platform: string): SocialPlatformAdapter {
  const adapter = adapters[platform]

  if (!adapter) {
    throw createError({
      statusCode: 400,
      message: `Неподдерживаемая платформа: ${platform}. Доступные: ${Object.keys(adapters).join(", ")}`,
    })
  }

  return adapter
}
