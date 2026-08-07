import type { Prisma } from '../../../../app/generated/prisma/client'
import {
  attributionSource,
  buildConversionTrackingUrl,
  buildTelegramTrackingUrl,
  createAttributionIdempotencyKey,
  normalizeAttributionEventType,
  verifyContentFactoryWebhookSecret,
} from '../../../utils/content-factory-attribution'

const requestWindows = new Map<string, { startedAt: number; count: number }>()
const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_MINUTE = 120

function consumeRateLimit(key: string): boolean {
  const now = Date.now()
  const current = requestWindows.get(key)
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 })
    return true
  }
  current.count++
  return current.count <= MAX_REQUESTS_PER_MINUTE
}

function requestSecret(event: Parameters<typeof getRequestHeader>[0]): string {
  const explicit = getRequestHeader(event, 'x-content-factory-secret')?.trim()
  if (explicit) return explicit
  const authorization = getRequestHeader(event, 'authorization')?.trim() ?? ''
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : ''
}

function objectConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function deliveryTrackingUrl(funnel: {
  deliveryAdapter: string
  deliveryConfig: unknown
}, trackingToken: string): string | null {
  const config = objectConfig(funnel.deliveryConfig)
  if (funnel.deliveryAdapter === 'telegram') {
    return buildTelegramTrackingUrl(String(config.botUsername ?? ''), trackingToken)
  }
  const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : ''
  if (!baseUrl) return null
  const trackingParam = typeof config.trackingParam === 'string' ? config.trackingParam : 'tracking_token'
  return buildConversionTrackingUrl(baseUrl, trackingParam, trackingToken)
}

export default defineEventHandler(async (event) => {
  const trackingToken = getRouterParam(event, 'trackingToken')
  if (!trackingToken || !/^cf_[A-Za-z0-9_-]{16,61}$/.test(trackingToken)) {
    throw createError({ statusCode: 400, message: 'Invalid tracking token' })
  }

  const rawBody = await readRawBody(event)
  if (rawBody && Buffer.byteLength(rawBody, 'utf8') > 64_000) {
    throw createError({ statusCode: 413, message: 'Event payload is too large' })
  }
  let body: Record<string, unknown> = {}
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object expected')
      body = parsed as Record<string, unknown>
    } catch {
      throw createError({ statusCode: 400, message: 'Body must be a JSON object' })
    }
  }

  const publicationId = typeof body.publicationId === 'string' ? body.publicationId.trim() : ''
  const mediaId = typeof body.mediaId === 'string' ? body.mediaId.trim() : ''
  const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : ''
  const socialAccountId = Number(body.socialAccountId)
  const candidates = await prisma.factoryPublication.findMany({
    where: {
      trackingToken,
      ...(publicationId
        ? { id: publicationId }
        : mediaId
          ? { OR: [{ platformPostId: mediaId }, { upload: { platformPostId: mediaId } }] }
          : {}),
      ...(platform ? { platform: platform as never } : {}),
      ...(Number.isInteger(socialAccountId) && socialAccountId > 0 ? { socialAccountId } : {}),
    },
    include: {
      funnel: { include: { leadMagnet: true } },
      // Магнит гипотезы — запасной источник выдачи. Основной путь привязывает
      // материал к воронке, но у публикаций, созданных до этой привязки,
      // funnel.leadMagnet пуст, а гипотеза свой магнит помнит всегда.
      hypothesis: { select: { id: true, leadMagnetId: true, leadMagnet: true } },
      socialAccount: {
        select: { id: true, displayName: true, platformHandle: true, platformUserId: true },
      },
      upload: { select: { platformPostId: true, platformPostUrl: true, status: true } },
      run: {
        select: { scenarios: { select: { id: true }, take: 1, orderBy: { createdAt: 'asc' } } },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 2,
  })
  if (candidates.length === 0) throw createError({ statusCode: 404, message: 'Publication not found for tracking token' })
  if (candidates.length > 1) {
    throw createError({ statusCode: 409, message: 'Multiple publications found; provide publicationId, mediaId, platform or socialAccountId' })
  }
  const publication = candidates[0]!
  if (!publication.funnel) throw createError({ statusCode: 409, message: 'Publication has no active funnel' })

  const ip = String(
    getRequestHeader(event, 'x-forwarded-for')
    || getRequestHeader(event, 'x-real-ip')
    || 'unknown',
  ).split(',')[0]!.trim()
  if (!consumeRateLimit(`${publication.funnel.id}:${ip}`)) {
    setResponseHeader(event, 'Retry-After', '60')
    throw createError({ statusCode: 429, message: 'Too many events' })
  }

  if (!verifyContentFactoryWebhookSecret(requestSecret(event), publication.funnel.webhookSecretHash)) {
    throw createError({ statusCode: 401, message: 'Invalid integration secret' })
  }

  const type = normalizeAttributionEventType(body.eventType ?? body.type)
  if (!type) throw createError({ statusCode: 400, message: 'Unknown eventType' })
  const source = attributionSource(type)
  const externalEventId = typeof body.externalEventId === 'string' ? body.externalEventId.slice(0, 300) : undefined
  const externalUserId = typeof body.externalUserId === 'string' ? body.externalUserId.slice(0, 300) : undefined
  const messengerUserId = typeof body.messengerUserId === 'string' || typeof body.messengerUserId === 'number'
    ? String(body.messengerUserId).slice(0, 100)
    : undefined
  const knownMediaId = publication.platformPostId ?? publication.upload?.platformPostId ?? null
  if (knownMediaId && mediaId && knownMediaId !== mediaId) {
    throw createError({ statusCode: 409, message: 'mediaId does not belong to this publication' })
  }

  const idempotencyKey = createAttributionIdempotencyKey({
    publicationId: publication.id,
    type,
    source,
    externalEventId,
    externalUserId,
    payload: body,
  })
  const existingEvent = await prisma.attributionEvent.findUnique({ where: { idempotencyKey }, select: { id: true } })
  const occurredAtRaw = typeof body.occurredAt === 'string' ? new Date(body.occurredAt) : null
  const occurredAt = occurredAtRaw && !Number.isNaN(occurredAtRaw.getTime()) ? occurredAtRaw : new Date()
  const savedEvent = await prisma.attributionEvent.upsert({
    where: { idempotencyKey },
    create: {
      publicationId: publication.id,
      trackingToken,
      type,
      source,
      idempotencyKey,
      externalEventId,
      externalUserId,
      messengerUserId,
      payload: body as Prisma.InputJsonValue,
      occurredAt,
    },
    update: {},
  })

  const deliveryUrl = deliveryTrackingUrl(publication.funnel, trackingToken)
  const conversionUrl = buildConversionTrackingUrl(
    publication.funnel.conversionUrl,
    publication.funnel.conversionTrackingParam,
    trackingToken,
  )
  const platformPostUrl = publication.platformPostUrl ?? publication.upload?.platformPostUrl ?? null
  const leadMagnet = publication.funnel.leadMagnet ?? publication.hypothesis?.leadMagnet ?? null

  return {
    data: {
      eventId: savedEvent.id,
      duplicate: Boolean(existingEvent),
      trackingToken,
      publicationId: publication.id,
      delivery: { adapter: publication.funnel.deliveryAdapter, url: deliveryUrl },
      conversion: { adapter: publication.funnel.conversionAdapter, url: conversionUrl },
      keyword: publication.keyword ?? publication.funnel.keyword,
      leadMagnet: leadMagnet
        ? {
            id: leadMagnet.id,
            title: leadMagnet.title,
            content: leadMagnet.content,
            deliveryMessage: leadMagnet.deliveryMessage,
            warmupMessages: leadMagnet.warmupMessages,
          }
        : null,
      attribution: {
        platform: publication.platform,
        socialAccountId: publication.socialAccountId,
        socialAccount: publication.socialAccount.displayName,
        platformHandle: publication.socialAccount.platformHandle,
        mediaId: knownMediaId,
        platformPostUrl,
        hypothesisId: publication.hypothesis?.id ?? null,
        scriptId: publication.run.scenarios[0]?.id ?? null,
        funnelId: publication.funnel.id,
        leadMagnetId: publication.funnel.leadMagnetId ?? publication.hypothesis?.leadMagnetId ?? null,
        messengerUserId: messengerUserId ?? null,
        occurredAt: savedEvent.occurredAt,
      },
    },
  }
})