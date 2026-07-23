import { describe, expect, it } from 'vitest'
import {
  buildChatPlaceArguments,
  buildChatPlacePrompt,
  extractChatPlaceExternalId,
  selectChatPlaceTool,
} from '../../server/utils/factory-automation/chatplace-mcp'
import type { FactoryAutomationInput } from '../../server/utils/factory-automation/types'

function input(overrides: Partial<FactoryAutomationInput> = {}): FactoryAutomationInput {
  return {
    publicationId: 'pub-1',
    stableReference: 'CF:pub-1',
    trackingToken: 'cf_abcdefghijklmnop',
    platform: 'instagram',
    platformPostId: 'media-1',
    platformPostUrl: 'https://instagram.com/reel/media-1',
    keyword: 'ГАЙД',
    funnel: {
      id: 'funnel-1',
      name: 'Основная воронка',
      deliveryAdapter: 'chatplace',
      automationConfig: {},
    },
    socialAccount: {
      id: 7,
      displayName: 'Лиана',
      platformUserId: 'ig-7',
      platformHandle: 'liana',
    },
    leadMagnet: {
      id: 'lead-1',
      title: 'Чек-лист',
      content: { blocks: ['one', 'two'] },
      deliveryMessage: 'Забирайте чек-лист',
      warmupMessages: ['Как вам материал?'],
    },
    conversionUrl: 'https://example.com/form?tracking_token=cf_abcdefghijklmnop',
    attribution: {
      enabled: true,
      webhookUrl: 'https://factory.example.com/api/factory/attribution/cf_abcdefghijklmnop',
      webhookSecret: 'cfw_webhook-secret',
    },
    ...overrides,
  }
}

describe('ChatPlace automation adapter', () => {
  it('selects an unambiguous creation tool from runtime discovery', () => {
    const selected = selectChatPlaceTool([
      { name: 'list_bots', description: 'List existing bots' },
      {
        name: 'create_automation',
        description: 'Create an automation funnel for a keyword trigger',
      },
    ])
    expect(selected.name).toBe('create_automation')
  })

  it('requires an explicit name when discovery is ambiguous', () => {
    expect(() => selectChatPlaceTool([
      { name: 'create_bot', description: 'Create automation' },
      { name: 'create_funnel', description: 'Create automation' },
    ])).toThrow('Several ChatPlace MCP tools')
  })

  it('builds an idempotent prompt with delivery, attribution and follower check', () => {
    const prompt = buildChatPlacePrompt(input())
    expect(prompt).toContain('CF:pub-1')
    expect(prompt).toContain('Не создавай дубль')
    expect(prompt).toContain('ГАЙД')
    expect(prompt).toContain('проверь подписку')
    expect(prompt).toContain('lead_magnet_delivered')
    expect(prompt).toContain('cfw_webhook-secret')
  })

  it('infers common tool arguments from a discovered JSON schema', () => {
    const arguments_ = buildChatPlaceArguments({
      name: 'create_automation',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          keyword: { type: 'string' },
          external_id: { type: 'string' },
          post_url: { type: 'string' },
        },
        required: ['prompt', 'keyword', 'external_id'],
      },
    }, input())

    expect(arguments_.keyword).toBe('ГАЙД')
    expect(arguments_.external_id).toBe('CF:pub-1')
    expect(arguments_.post_url).toContain('instagram.com/reel')
    expect(arguments_.prompt).toContain('Основная воронка')
  })

  it('supports explicit argument templates for provider schema changes', () => {
    const configured = input({
      funnel: {
        id: 'funnel-1',
        name: 'Основная воронка',
        deliveryAdapter: 'chatplace',
        automationConfig: {
          arguments: {
            query: '{{prompt}}',
            metadata: {
              externalId: '{stableReference}',
              publicationId: '{publicationId}',
            },
          },
        },
      },
    })
    const arguments_ = buildChatPlaceArguments({
      name: 'custom_tool',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    }, configured)

    expect(arguments_.query).toContain('ГАЙД')
    expect(arguments_.metadata).toEqual({
      externalId: 'CF:pub-1',
      publicationId: 'pub-1',
    })
  })

  it('fails closed when required provider arguments cannot be inferred', () => {
    expect(() => buildChatPlaceArguments({
      name: 'create_automation',
      inputSchema: {
        type: 'object',
        properties: { workspace: { type: 'string' } },
        required: ['workspace'],
      },
    }, input())).toThrow('requires unknown arguments: workspace')
  })

  it('extracts an automation id from text content returned by MCP', () => {
    expect(extractChatPlaceExternalId({
      content: [{ type: 'text', text: '{"automationId":"cp-42"}' }],
    }, 'CF:pub-1')).toBe('cp-42')
  })
})
