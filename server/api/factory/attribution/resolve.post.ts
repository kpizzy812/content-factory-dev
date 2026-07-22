import { verifyContentFactoryWebhookSecret } from '../../../utils/content-factory-attribution'

function requestSecret(event: Parameters<typeof getRequestHeader>[0]): string {
  const explicit = getRequestHeader(event, 'x-content-factory-secret')?.trim()
  if (explicit) return explicit
  const authorization = getRequestHeader(event, 'authorization')?.trim() ?? ''
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : ''
}

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event)
  if (!rawBody) throw createError({ statusCode: 400, message: 'Request body is required' })
  if (Buffer.byteLength(rawBody, 'utf8') > 16_000) {
    throw createError({ statusCode: 413, message: 'Request is too large' })
  }

  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object expected')
    body = parsed as Record<string, unknown>
  } catch {
    throw createError({ statusCode: 400, message: 'Body must be a JSON object' })
  }

  const publicationId = typeof body.publicationId === 'string' ? body.publicationId.trim() : ''
  const mediaId = typeof body.mediaId === 'string' ? body.mediaId.trim() : ''
  const platformPostUrl = typeof body.platformPostUrl === 'string' ? body.platformPostUrl.trim() : ''
  const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : ''
  const socialAccountId = Number(body.socialAccountId)
  if (!publicationId && !mediaId && !platformPostUrl) {
    throw createError({ statusCode: 400, message: 'publicationId, mediaId or platformPostUrl is required' })
  }
  if (body.socialAccountId !== undefined && (!Number.isInteger(socialAccountId) || socialAccountId <= 0)) {
    throw createError({ statusCode: 400, message: 'Invalid socialAccountId' })
  }

  const candidates = await prisma.factoryPublication.findMany({
    where: {
      ...(publicationId
        ? { id: publicationId }
        : mediaId
          ? { OR: [{ platformPostId: mediaId }, { upload: { platformPostId: mediaId } }] }
          : { OR: [{ platformPostUrl }, { upload: { platformPostUrl } }] }),
      ...(platform ? { platform: platform as never } : {}),
      ...(Number.isInteger(socialAccountId) && socialAccountId > 0 ? { socialAccountId } : {}),
    },
    include: { funnel: { select: { id: true, webhookSecretHash: true } } },
    orderBy: { createdAt: 'desc' },
    take: 2,
  })

  if (candidates.length === 0) throw createError({ statusCode: 404, message: 'Publication not found' })
  if (candidates.length > 1) {
    throw createError({ statusCode: 409, message: 'Multiple publications found; provide socialAccountId, platform or publicationId' })
  }
  const publication = candidates[0]!
  if (!publication.funnel) throw createError({ statusCode: 409, message: 'Publication has no active funnel' })
  if (!verifyContentFactoryWebhookSecret(requestSecret(event), publication.funnel.webhookSecretHash)) {
    throw createError({ statusCode: 401, message: 'Invalid integration secret' })
  }

  const origin = getRequestURL(event).origin
  return {
    data: {
      publicationId: publication.id,
      trackingToken: publication.trackingToken,
      keyword: publication.keyword,
      eventUrl: `${origin}/api/factory/attribution/${publication.trackingToken}`,
    },
  }
})