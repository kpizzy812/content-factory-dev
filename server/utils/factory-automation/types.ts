export interface FactoryAutomationInput {
  publicationId: string
  stableReference: string
  trackingToken: string
  platform: string
  platformPostId: string | null
  platformPostUrl: string | null
  keyword: string
  funnel: {
    id: string
    name: string
    deliveryAdapter: string
    automationConfig: Record<string, unknown>
  }
  socialAccount: {
    id: number
    displayName: string
    platformUserId: string | null
    platformHandle: string | null
  }
  leadMagnet: {
    id: string
    title: string
    content: unknown
    deliveryMessage: string | null
    warmupMessages: unknown
  } | null
  conversionUrl: string
  attribution: {
    enabled: boolean
    webhookUrl: string | null
    webhookSecret: string | null
  }
}

export interface FactoryAutomationResult {
  externalId: string
  provider: string
  toolName: string
  metadata?: Record<string, unknown>
}

export interface FactoryAutomationAdapter {
  sync(input: FactoryAutomationInput): Promise<FactoryAutomationResult>
}

export interface FactoryAutomationSyncResult {
  publicationId: string
  status: string
  externalId: string | null
  provider: string | null
  skipped: boolean
  reason?: string
}
