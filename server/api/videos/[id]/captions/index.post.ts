/**
 * POST /api/videos/[id]/captions
 *
 * Запускает caption-generator-агента вручную (без pipeline) для указанных платформ
 * и возвращает свежесгенерированные captions. Если для (videoId, platform) уже была
 * запись — её затирает (upsert).
 *
 * Body:
 *   - platforms: SocialPlatform[] (default ['tiktok','youtube','instagram'])
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
  const platforms = (
    Array.isArray(body.platforms) && body.platforms.length > 0
      ? body.platforms
      : ['tiktok', 'youtube', 'instagram']
  )
    .map((p) => String(p).toLowerCase())
    .filter((p): p is SocialPlatform => VALID_PLATFORMS.has(p as SocialPlatform))

  if (platforms.length === 0) {
    throw createError({ statusCode: 400, message: 'platforms пустой или невалидный' })
  }

  const styleVariant = (
    typeof body.styleVariant === 'string' && VALID_STYLE.has(body.styleVariant)
      ? body.styleVariant
      : 'viral'
  ) as 'viral' | 'informative' | 'storytelling'
  const styleHints = typeof body.styleHints === 'string' ? body.styleHints.slice(0, 500) : undefined

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

  const userId = user.id
  const created: Array<unknown> = []
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
        generatedById: userId,
      },
      update: {
        title: c.title,
        description: c.description ?? null,
        hashtags: c.hashtags,
        charsTitle: c.title.length,
        charsHashtagsTotal,
        fitsLimits: c.fitsLimits,
        modelVersion: result.modelVersion,
        approvedAt: null, // re-generate сбрасывает approval
        approvedById: null,
      },
    })
    created.push(saved)
  }

  return {
    data: {
      captions: created,
      contextUsed: result.contextUsed,
      generatedAt: result.generatedAt,
    },
  }
})
