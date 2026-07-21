/**
 * PUT /api/videos/[id]/captions/[platform]
 *
 * Редактирует существующую caption (title, description, hashtags).
 * Пересчитывает charsTitle/charsHashtagsTotal/fitsLimits снапшот.
 * Сбрасывает approvedAt — оператор должен повторно утвердить после правки.
 */

import type { SocialPlatform } from '~~/shared/types/caption'
import { calculateHashtagsLength, validateCaption, PLATFORM_LIMITS } from '~~/server/utils/caption-limits'

interface Body {
  title?: string
  description?: string | null
  hashtags?: string[]
}

const VALID_PLATFORMS: ReadonlySet<SocialPlatform> = new Set(['tiktok', 'youtube', 'instagram'])

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canWrite'],
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

  const body = (await readBody<Body>(event)) ?? {}

  const existing = await prisma.caption.findUnique({
    where: { videoId_platform: { videoId: id, platform: platform as never } },
  })
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Caption не найден — создайте через POST' })
  }

  // Очищаем входные данные. Hashtag — без префикса #, без пробелов.
  const newTitle = typeof body.title === 'string' ? body.title.trim() : existing.title
  const newDescription =
    body.description === null
      ? null
      : typeof body.description === 'string'
        ? body.description.trim() || null
        : existing.description
  const newHashtags = Array.isArray(body.hashtags)
    ? body.hashtags
      .filter((h): h is string => typeof h === 'string')
      .map((h) => h.replace(/^#+/, '').trim())
      .filter((h) => h.length > 0 && !h.includes(' '))
    : existing.hashtags

  // Базовая валидация длины
  const limits = PLATFORM_LIMITS[platform as SocialPlatform]
  if (newTitle.length === 0) {
    throw createError({ statusCode: 400, message: 'Title не может быть пустым' })
  }
  if (newTitle.length > limits.titleMaxChars * 1.5) {
    // hard cap чтобы не сохранять явный мусор; обычное превышение допускаем (fitsLimits=false)
    throw createError({
      statusCode: 400,
      message: `Title слишком длинный (>${Math.round(limits.titleMaxChars * 1.5)} символов)`,
    })
  }

  const charsHashtagsTotal = calculateHashtagsLength(newHashtags)
  const validation = validateCaption({
    platform: platform as SocialPlatform,
    title: newTitle,
    description: newDescription ?? undefined,
    hashtags: newHashtags,
    limits,
    fitsLimits: false,
  })

  const updated = await prisma.caption.update({
    where: { videoId_platform: { videoId: id, platform: platform as never } },
    data: {
      title: newTitle,
      description: newDescription,
      hashtags: newHashtags,
      charsTitle: newTitle.length,
      charsHashtagsTotal,
      fitsLimits: validation.valid,
      approvedAt: null, // правка сбрасывает approval
      approvedById: null,
    },
  })

  return { data: updated, validation }
})
