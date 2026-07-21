/**
 * POST /api/videos/[id]/captions/regenerate
 *
 * Перегенерирует captions через AI-агента. Эквивалентно POST /captions, но с
 * семантически отдельным endpoint'ом (UI кнопка "Сгенерировать заново").
 *
 * Body:
 *   - platforms?: SocialPlatform[]  — какие именно платформы перегенерить (default: те, что уже есть)
 *   - styleVariant?: 'viral' | 'informative' | 'storytelling'
 *   - styleHints?: string
 */

import type { SocialPlatform } from '~~/shared/types/caption'
import { runCaptionGenerator } from '~~/server/utils/agents/caption-generator-agent'

interface Body {
  platforms?: string[]
  styleVariant?: string
  styleHints?: string
}

const VALID_PLATFORMS: ReadonlySet<SocialPlatform> = new Set(['tiktok', 'youtube', 'instagram'])
const VALID_STYLE = new Set(['viral', 'informative', 'storytelling'])

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'video-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID видео' })
  }

  const body = (await readBody<Body>(event)) ?? {}

  const video = await prisma.video.findUnique({
    where: { id },
    include: {
      scenario: {
        include: {
          variants: {
            where: { status: 'accepted' as never },
            take: 1,
            orderBy: { variantIndex: 'asc' as const },
          },
        },
      },
    },
  })
  if (!video) {
    throw createError({ statusCode: 404, message: 'Видео не найдено' })
  }

  // Если platforms не передан — используем те, что уже есть в БД для этого видео
  let platforms: SocialPlatform[]
  if (Array.isArray(body.platforms) && body.platforms.length > 0) {
    platforms = body.platforms
      .map((p) => String(p).toLowerCase())
      .filter((p): p is SocialPlatform => VALID_PLATFORMS.has(p as SocialPlatform))
  } else {
    const existing = await prisma.caption.findMany({
      where: { videoId: id },
      select: { platform: true },
    })
    platforms = existing
      .map((e) => String(e.platform).toLowerCase())
      .filter((p): p is SocialPlatform => VALID_PLATFORMS.has(p as SocialPlatform))
    if (platforms.length === 0) platforms = ['tiktok', 'youtube', 'instagram']
  }
  if (platforms.length === 0) {
    throw createError({ statusCode: 400, message: 'Не выбрано ни одной валидной платформы' })
  }

  const styleVariant = (
    typeof body.styleVariant === 'string' && VALID_STYLE.has(body.styleVariant)
      ? body.styleVariant
      : 'viral'
  ) as 'viral' | 'informative' | 'storytelling'
  const styleHints = typeof body.styleHints === 'string' ? body.styleHints.slice(0, 500) : undefined

  const variant = video.scenario?.variants[0] ?? null
  const appId = video.applicationId ?? video.scenario?.appId ?? null
  const app = appId ? await prisma.app.findUnique({ where: { id: appId } }) : null

  const result = await runCaptionGenerator({
    videoId: video.id,
    scenarioId: video.scenarioId,
    platforms,
    styleHints,
    styleVariant,
    context: {
      storyPlan: variant?.storyPlan as Record<string, unknown> | null,
      hook: variant?.hook ?? null,
      body: variant?.body ?? null,
      cta: variant?.cta ?? null,
      fullScript: variant?.fullScript ?? null,
      appName: app?.name ?? null,
      appBrandTone: app?.brandTone ?? null,
      appCorePain: app?.corePain ?? null,
      appTransformationPromise: app?.transformationPromise ?? null,
      appForbiddenClaims: app?.forbiddenClaims ?? null,
      targetPlatform: video.targetPlatform as SocialPlatform | null,
      videoDurationSec: video.duration ?? null,
      marketingTitle: variant?.title ?? null,
    },
  })

  const updated: Array<unknown> = []
  for (const platform of platforms) {
    const c = result.captions[platform]
    if (!c) continue
    const charsHashtagsTotal = c.hashtags.length === 0
      ? 0
      : c.hashtags.map((h) => `#${h}`).join(' ').length
    const saved = await prisma.caption.upsert({
      where: { videoId_platform: { videoId: video.id, platform: platform as never } },
      create: {
        videoId: video.id,
        platform: platform as never,
        title: c.title,
        description: c.description ?? null,
        hashtags: c.hashtags,
        charsTitle: c.title.length,
        charsHashtagsTotal,
        fitsLimits: c.fitsLimits,
        modelVersion: result.modelVersion,
        promptVersion: 'v1',
        generatedById: user.id,
      },
      update: {
        title: c.title,
        description: c.description ?? null,
        hashtags: c.hashtags,
        charsTitle: c.title.length,
        charsHashtagsTotal,
        fitsLimits: c.fitsLimits,
        modelVersion: result.modelVersion,
        approvedAt: null,
        approvedById: null,
      },
    })
    updated.push(saved)
  }

  return {
    data: {
      captions: updated,
      contextUsed: result.contextUsed,
      generatedAt: result.generatedAt,
    },
  }
})
