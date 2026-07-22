import { describe, expect, it } from 'vitest'
import {
  attributionSource,
  buildConversionTrackingUrl,
  buildTelegramTrackingUrl,
  createAttributionIdempotencyKey,
  generateContentFactoryWebhookSecret,
  hashContentFactoryWebhookSecret,
  normalizeAttributionEventType,
  verifyContentFactoryWebhookSecret,
} from '../../server/utils/content-factory-attribution'

describe('content factory attribution', () => {
  it('stores webhook secrets as hashes and compares them safely', () => {
    const secret = generateContentFactoryWebhookSecret()
    const hash = hashContentFactoryWebhookSecret(secret)
    expect(secret).toMatch(/^cfw_[A-Za-z0-9_-]+$/)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(verifyContentFactoryWebhookSecret(secret, hash)).toBe(true)
    expect(verifyContentFactoryWebhookSecret(`${secret}x`, hash)).toBe(false)
  })

  it('builds delivery and conversion links with the same tracking token', () => {
    const token = 'cf_12_4_1234567890abcdef1234567890abcdef'
    expect(buildTelegramTrackingUrl('@content_bot', token)).toBe(
      `https://t.me/content_bot?start=${token}`,
    )
    expect(buildConversionTrackingUrl('https://apply.example.com/form?utm=ig', 'tracking_token', token)).toBe(
      `https://apply.example.com/form?utm=ig&tracking_token=${token}`,
    )
  })

  it('normalizes event aliases and assigns their source', () => {
    expect(normalizeAttributionEventType('comment')).toBe('automation_comment')
    expect(normalizeAttributionEventType('form_submitted')).toBe('conversion_submitted')
    expect(normalizeAttributionEventType('unknown')).toBeNull()
    expect(attributionSource('automation_direct')).toBe('automation')
    expect(attributionSource('messenger_opened')).toBe('messenger')
    expect(attributionSource('conversion_submitted')).toBe('conversion')
  })

  it('creates a stable idempotency key for retries', () => {
    const base = {
      publicationId: 'pub_1',
      type: 'automation_comment' as const,
      source: 'automation',
      externalUserId: 'ig_42',
    }
    const first = createAttributionIdempotencyKey({ ...base, payload: { keyword: 'PLAN', mediaId: '11' } })
    const retry = createAttributionIdempotencyKey({ ...base, payload: { mediaId: '11', keyword: 'PLAN' } })
    const other = createAttributionIdempotencyKey({ ...base, externalEventId: 'comment_2' })
    expect(first).toBe(retry)
    expect(other).not.toBe(first)
  })
})
