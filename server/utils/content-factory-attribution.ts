import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const ATTRIBUTION_EVENT_TYPES = [
  'automation_comment',
  'automation_direct',
  'messenger_opened',
  'lead_magnet_delivered',
  'conversion_opened',
  'conversion_submitted',
  'sale_attributed',
] as const

export type AttributionEventType = typeof ATTRIBUTION_EVENT_TYPES[number]

const EVENT_ALIASES: Record<string, AttributionEventType> = {
  comment: 'automation_comment',
  automation_comment: 'automation_comment',
  direct: 'automation_direct',
  dm: 'automation_direct',
  automation_direct: 'automation_direct',
  messenger: 'messenger_opened',
  messenger_opened: 'messenger_opened',
  lead_magnet: 'lead_magnet_delivered',
  lead_magnet_delivered: 'lead_magnet_delivered',
  conversion_opened: 'conversion_opened',
  form_opened: 'conversion_opened',
  conversion_submitted: 'conversion_submitted',
  form_submitted: 'conversion_submitted',
  sale: 'sale_attributed',
  sale_attributed: 'sale_attributed',
}

export function generateContentFactoryWebhookSecret(): string {
  return `cfw_${randomBytes(32).toString('base64url')}`
}

export function hashContentFactoryWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function verifyContentFactoryWebhookSecret(secret: string, expectedHash: string): boolean {
  if (!secret || !expectedHash) return false
  const actual = Buffer.from(hashContentFactoryWebhookSecret(secret), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function normalizeAttributionEventType(value: unknown): AttributionEventType | null {
  const key = String(value ?? '').trim().toLowerCase()
  return EVENT_ALIASES[key] ?? null
}

export function attributionSource(type: AttributionEventType): 'automation' | 'messenger' | 'conversion' | 'system' {
  if (type.startsWith('automation_')) return 'automation'
  if (type === 'messenger_opened' || type === 'lead_magnet_delivered') return 'messenger'
  if (type.startsWith('conversion_')) return 'conversion'
  return 'system'
}

function normalizeTelegramBotUsername(value: string): string {
  const username = value.trim().replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw new Error('Invalid Telegram bot username')
  }
  return username
}

export function buildTelegramTrackingUrl(botUsername: string, trackingToken: string): string {
  const username = normalizeTelegramBotUsername(botUsername)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trackingToken)) {
    throw new Error('Tracking token cannot be passed through Telegram /start')
  }
  return `https://t.me/${username}?start=${encodeURIComponent(trackingToken)}`
}

export function buildConversionTrackingUrl(baseUrl: string, trackingParam: string, trackingToken: string): string {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Conversion URL must use HTTP(S)')
  const param = trackingParam.trim() || 'tracking_token'
  url.searchParams.set(param, trackingToken)
  return url.toString()
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  return value
}

export function createAttributionIdempotencyKey(input: {
  publicationId: string
  type: AttributionEventType
  source: string
  externalEventId?: string
  externalUserId?: string
  payload?: unknown
}): string {
  const identity = input.externalEventId?.trim()
    ? `external:${input.externalEventId.trim()}`
    : JSON.stringify(stableValue({ externalUserId: input.externalUserId ?? null, payload: input.payload ?? null }))
  return createHash('sha256')
    .update(`${input.publicationId}:${input.source}:${input.type}:${identity}`, 'utf8')
    .digest('hex')
}
