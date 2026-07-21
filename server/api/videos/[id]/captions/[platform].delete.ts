/**
 * DELETE /api/videos/[id]/captions/[platform]
 *
 * Удаляет caption для конкретной платформы.
 * После удаления Upload вернётся к placeholder title/description (как до Caption Generator).
 */

import type { SocialPlatform } from '~~/shared/types/caption'

const VALID_PLATFORMS: ReadonlySet<SocialPlatform> = new Set(['tiktok', 'youtube', 'instagram'])

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canDelete'],
    moduleSlug: 'video-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID видео' })
  }
  const platform = String(getRouterParam(event, 'platform') ?? '').toLowerCase()
  if (!VALID_PLATFORMS.has(platform as SocialPlatform)) {
    throw createError({ statusCode: 400, message: `Неизвестная платформа: ${platform}` })
  }

  const existing = await prisma.caption.findUnique({
    where: { videoId_platform: { videoId: id, platform: platform as never } },
    select: { id: true },
  })
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Caption не найден' })
  }

  await prisma.caption.delete({
    where: { videoId_platform: { videoId: id, platform: platform as never } },
  })

  return { data: { ok: true } }
})
