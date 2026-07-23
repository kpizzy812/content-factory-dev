import type { Prisma } from '../../../app/generated/prisma/client'
import { buildConversionTrackingUrl } from '../content-factory-attribution'
import { decrypt } from '../crypto'
import { prisma } from '../prisma'
import { createChatPlaceMcpAdapter } from './chatplace-mcp'
import type {
  FactoryAutomationAdapter,
  FactoryAutomationInput,
  FactoryAutomationSyncResult,
} from './types'

const MAX_ATTEMPTS = 5
const STALE_SYNC_MS = 15 * 60_000

function objectConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeError(error: unknown, secrets: string[] = []): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[REDACTED]')
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, 1_000) || 'Unknown automation error'
}

function publicBaseUrl(): string {
  const raw = process.env.CONTENT_FACTORY_PUBLIC_URL
    || process.env.REPLICATE_WEBHOOK_BASE_URL
    || ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('CONTENT_FACTORY_PUBLIC_URL must be a valid absolute URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('CONTENT_FACTORY_PUBLIC_URL must use HTTP(S)')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('CONTENT_FACTORY_PUBLIC_URL must use HTTPS in production')
  }
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function adapterFor(name: string): FactoryAutomationAdapter {
  if (name === 'chatplace_mcp') return createChatPlaceMcpAdapter()
  throw new Error(`Unsupported factory automation adapter: ${name}`)
}

export function isFactoryAutomationSyncEnabled(): boolean {
  return process.env.ENABLE_AUTOMATION_SYNC === 'true'
}

function pendingResult(
  publicationId: string,
  status: string,
  externalId: string | null,
  reason: string,
): FactoryAutomationSyncResult {
  return {
    publicationId,
    status,
    externalId,
    provider: null,
    skipped: true,
    reason,
  }
}

export async function syncFactoryPublicationAutomation(
  publicationId: string,
): Promise<FactoryAutomationSyncResult> {
  if (!isFactoryAutomationSyncEnabled()) {
    throw new Error('Factory automation sync is disabled by ENABLE_AUTOMATION_SYNC')
  }

  const before = await prisma.factoryPublication.findUnique({
    where: { id: publicationId },
    select: {
      id: true,
      status: true,
      automationStatus: true,
      automationExternalId: true,
      automationAttempts: true,
      funnel: {
        select: {
          automationAdapter: true,
          status: true,
        },
      },
    },
  })
  if (!before) throw new Error('Factory publication not found')
  if (before.status !== 'published') {
    return pendingResult(before.id, before.automationStatus, before.automationExternalId, 'publication_not_published')
  }
  if (!before.funnel || before.funnel.status !== 'active' || !before.funnel.automationAdapter) {
    return pendingResult(before.id, before.automationStatus, before.automationExternalId, 'automation_not_configured')
  }
  if (before.automationStatus === 'synced') {
    return {
      publicationId: before.id,
      status: before.automationStatus,
      externalId: before.automationExternalId,
      provider: before.funnel.automationAdapter,
      skipped: true,
      reason: 'already_synced',
    }
  }
  if (before.automationAttempts >= MAX_ATTEMPTS) {
    return pendingResult(before.id, before.automationStatus, before.automationExternalId, 'max_attempts_reached')
  }

  const startedAt = new Date()
  const staleBefore = new Date(startedAt.getTime() - STALE_SYNC_MS)
  const claimed = await prisma.factoryPublication.updateMany({
    where: {
      id: publicationId,
      status: 'published',
      automationAttempts: { lt: MAX_ATTEMPTS },
      OR: [
        { automationStatus: { in: ['not_requested', 'failed'] } },
        {
          automationStatus: 'syncing',
          automationStartedAt: { lt: staleBefore },
        },
      ],
    },
    data: {
      automationStatus: 'syncing',
      automationStartedAt: startedAt,
      automationError: null,
      automationAttempts: { increment: 1 },
    },
  })
  if (claimed.count === 0) {
    const current = await prisma.factoryPublication.findUnique({
      where: { id: publicationId },
      select: {
        automationStatus: true,
        automationExternalId: true,
        funnel: { select: { automationAdapter: true } },
      },
    })
    return pendingResult(
      publicationId,
      current?.automationStatus ?? 'unknown',
      current?.automationExternalId ?? null,
      'sync_already_in_progress',
    )
  }

  let webhookSecret: string | null = null
  let adapterName: string | null = before.funnel.automationAdapter
  try {
    const publication = await prisma.factoryPublication.findUnique({
      where: { id: publicationId },
      include: {
        funnel: {
          include: {
            leadMagnet: true,
          },
        },
        socialAccount: {
          select: {
            id: true,
            displayName: true,
            platformUserId: true,
            platformHandle: true,
          },
        },
      },
    })
    if (!publication?.funnel?.automationAdapter) {
      throw new Error('Publication funnel has no automation adapter')
    }
    adapterName = publication.funnel.automationAdapter
    const automationConfig = objectConfig(publication.funnel.automationConfig)
    const attributionEnabled = automationConfig.attributionEnabled !== false
    if (attributionEnabled) {
      if (!publication.funnel.webhookSecretEncrypted) {
        throw new Error('Funnel webhook secret is not encrypted; rotate the funnel secret before automation sync')
      }
      webhookSecret = decrypt(publication.funnel.webhookSecretEncrypted)
    }
    const keyword = publication.keyword?.trim() || publication.funnel.keyword
    if (!keyword) throw new Error('Publication funnel has no keyword')

    const input: FactoryAutomationInput = {
      publicationId: publication.id,
      stableReference: `CF:${publication.id}`,
      trackingToken: publication.trackingToken,
      platform: publication.platform,
      platformPostId: publication.platformPostId,
      platformPostUrl: publication.platformPostUrl,
      keyword,
      funnel: {
        id: publication.funnel.id,
        name: publication.funnel.name,
        deliveryAdapter: publication.funnel.deliveryAdapter,
        automationConfig,
      },
      socialAccount: publication.socialAccount,
      leadMagnet: publication.funnel.leadMagnet
        ? {
            id: publication.funnel.leadMagnet.id,
            title: publication.funnel.leadMagnet.title,
            content: publication.funnel.leadMagnet.content,
            deliveryMessage: publication.funnel.leadMagnet.deliveryMessage,
            warmupMessages: publication.funnel.leadMagnet.warmupMessages,
          }
        : null,
      conversionUrl: buildConversionTrackingUrl(
        publication.funnel.conversionUrl,
        publication.funnel.conversionTrackingParam,
        publication.trackingToken,
      ),
      attribution: {
        enabled: attributionEnabled,
        webhookUrl: attributionEnabled
          ? `${publicBaseUrl()}/api/factory/attribution/${encodeURIComponent(publication.trackingToken)}`
          : null,
        webhookSecret,
      },
    }

    const result = await adapterFor(adapterName).sync(input)
    const snapshot = {
      provider: result.provider,
      toolName: result.toolName,
      stableReference: input.stableReference,
      ...(result.metadata ? { metadata: result.metadata } : {}),
    } as unknown as Prisma.InputJsonValue
    await prisma.factoryPublication.update({
      where: { id: publicationId },
      data: {
        automationStatus: 'synced',
        automationExternalId: result.externalId,
        automationError: null,
        automationSyncedAt: new Date(),
        automationSnapshot: snapshot,
      },
    })
    return {
      publicationId,
      status: 'synced',
      externalId: result.externalId,
      provider: result.provider,
      skipped: false,
    }
  } catch (error) {
    const message = safeError(error, [
      webhookSecret ?? '',
      process.env.CHATPLACE_API_KEY ?? '',
    ])
    await prisma.factoryPublication.update({
      where: { id: publicationId },
      data: {
        automationStatus: 'failed',
        automationError: message,
      },
    })
    throw new Error(message)
  }
}
