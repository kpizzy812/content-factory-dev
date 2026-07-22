import type { Prisma } from '../../../../app/generated/prisma/client'
import {
  buildConversionTrackingUrl,
  buildTelegramTrackingUrl,
  generateContentFactoryWebhookSecret,
  hashContentFactoryWebhookSecret,
} from '../../../utils/content-factory-attribution'

function adapterName(value: unknown, field: string, required = true): string | null {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!name && !required) return null
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(name)) {
    throw createError({ statusCode: 400, message: `${field} must be a valid adapter name` })
  }
  return name
}

function adapterConfig(value: unknown, field: string): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, message: `${field} must be an object` })
  }
  return value as Prisma.InputJsonValue
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const appId = Number(body?.appId)
  if (!Number.isInteger(appId) || appId <= 0) {
    throw createError({ statusCode: 400, message: 'appId is required' })
  }
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
    appId,
  })

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const keyword = typeof body.keyword === 'string' ? body.keyword.trim().replace(/^[@#]+/, '') : ''
  const leadMagnetId = typeof body.leadMagnetId === 'string' && body.leadMagnetId.trim()
    ? body.leadMagnetId.trim()
    : null
  const deliveryAdapter = adapterName(body.deliveryAdapter, 'deliveryAdapter')!
  const automationAdapter = adapterName(body.automationAdapter, 'automationAdapter', false)
  const conversionAdapter = adapterName(body.conversionAdapter, 'conversionAdapter')!
  const deliveryConfig = adapterConfig(body.deliveryConfig, 'deliveryConfig')
  const automationConfig = adapterConfig(body.automationConfig, 'automationConfig')
  const conversionUrl = typeof body.conversionUrl === 'string' ? body.conversionUrl.trim() : ''
  const conversionTrackingParam = typeof body.conversionTrackingParam === 'string'
    ? body.conversionTrackingParam.trim().slice(0, 64) || 'tracking_token'
    : 'tracking_token'

  if (name.length < 3 || name.length > 160) {
    throw createError({ statusCode: 400, message: 'Funnel name must contain 3-160 characters' })
  }
  if (!/^[\p{L}\p{N}_-]{2,64}$/u.test(keyword)) {
    throw createError({ statusCode: 400, message: 'Keyword must be one word with 2-64 letters or digits' })
  }
  try {
    buildConversionTrackingUrl(conversionUrl, conversionTrackingParam, 'validation_token')
    if (deliveryAdapter === 'telegram') {
      const botUsername = (body.deliveryConfig as { botUsername?: unknown } | undefined)?.botUsername
      buildTelegramTrackingUrl(String(botUsername ?? ''), 'validation_token')
    }
  } catch (error) {
    throw createError({ statusCode: 400, message: error instanceof Error ? error.message : 'Invalid adapter configuration' })
  }

  const [app, leadMagnet] = await Promise.all([
    prisma.app.findUnique({ where: { id: appId }, select: { id: true } }),
    leadMagnetId
      ? prisma.leadMagnet.findFirst({ where: { id: leadMagnetId, appId }, select: { id: true } })
      : Promise.resolve(null),
  ])
  if (!app) throw createError({ statusCode: 404, message: 'Application not found' })
  if (leadMagnetId && !leadMagnet) {
    throw createError({ statusCode: 404, message: 'Lead magnet not found in this application' })
  }

  const webhookSecret = generateContentFactoryWebhookSecret()
  const item = await prisma.contentFunnel.create({
    data: {
      appId,
      leadMagnetId,
      name,
      keyword,
      deliveryAdapter,
      deliveryConfig,
      automationAdapter,
      automationConfig,
      conversionAdapter,
      conversionUrl,
      conversionTrackingParam,
      webhookSecretHash: hashContentFactoryWebhookSecret(webhookSecret),
      createdById: user.id,
    },
    select: {
      id: true,
      appId: true,
      leadMagnetId: true,
      name: true,
      keyword: true,
      deliveryAdapter: true,
      automationAdapter: true,
      conversionAdapter: true,
      conversionUrl: true,
      conversionTrackingParam: true,
      status: true,
      createdAt: true,
    },
  })

  return {
    data: item,
    integration: {
      webhookSecret,
      secretShownOnce: true,
      headerName: 'X-Content-Factory-Secret',
      webhookUrlTemplate: `${getRequestURL(event).origin}/api/factory/attribution/{trackingToken}`,
      resolverUrl: `${getRequestURL(event).origin}/api/factory/attribution/resolve`,
    },
  }
})