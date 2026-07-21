/**
 * PUT /api/videos/[id]/captions/approve
 *
 * Утверждает caption для постинга. После approve Upload-нода (или ручная публикация)
 * подменит placeholder title/description/hashtags на эти значения.
 *
 * Approve блокируется если fitsLimits=false — оператор сначала должен поправить.
 *
 * Body:
 *   - platform: SocialPlatform   — какую именно caption утвердить
 *   - approve: boolean (default true) — false → отозвать approval
 */

import type { SocialPlatform } from '~~/shared/types/caption'

interface Body {
  platform?: string
  approve?: boolean
}

const VALID_PLATFORMS: ReadonlySet<SocialPlatform> = new Set(['tiktok', 'youtube', 'instagram'])

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canApprove'],
    moduleSlug: 'video-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID видео' })
  }

  const body = (await readBody<Body>(event)) ?? {}
  const platform = String(body.platform ?? '').toLowerCase()
  if (!VALID_PLATFORMS.has(platform as SocialPlatform)) {
    throw createError({ statusCode: 400, message: 'Не указана валидная platform' })
  }
  const approve = body.approve !== false

  const existing = await prisma.caption.findUnique({
    where: { videoId_platform: { videoId: id, platform: platform as never } },
  })
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Caption не найден' })
  }

  if (approve && !existing.fitsLimits) {
    throw createError({
      statusCode: 422,
      message: 'Caption не укладывается в лимиты платформы — поправьте перед утверждением',
    })
  }

  const updated = await prisma.caption.update({
    where: { videoId_platform: { videoId: id, platform: platform as never } },
    data: approve
      ? { approvedAt: new Date(), approvedById: user.id }
      : { approvedAt: null, approvedById: null },
  })

  return { data: updated }
})
