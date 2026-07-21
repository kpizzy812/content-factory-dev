import type { McCreativePayload, IdeaExportPayload } from '../../shared/types/idea'
import type { Prisma } from '../../app/generated/prisma/client'

/**
 * Маппинг MC Creative → данные для Prisma Idea upsert.
 */
export function mapMcCreativeToIdea(creative: McCreativePayload) {
  const platform = mapMcPlatform(creative.metadata?.platform as string | undefined)

  return {
    externalId: creative.id,
    source: 'marketingcamp' as const,
    title: creative.title,
    sourceUrl: creative.sourceUrl,
    thumbnailUrl: creative.thumbnailUrl,
    ...(platform ? { platform } : {}),
    language: creative.language,
    tags: creative.tags ?? [],
    mediaType: creative.type === 'video' ? 'video' : creative.type === 'image' ? 'image' : null,
    syncStatus: 'synced' as const,
    syncDirection: 'imported' as const,
    lastSyncedAt: new Date(),
    lastSyncError: null,
    remoteSnapshot: JSON.parse(JSON.stringify(creative)) as Prisma.InputJsonValue,
    localDirty: false,
  }
}

/**
 * Маппинг Prisma Idea → payload для экспорта в MC.
 */
export function mapIdeaToExportPayload(idea: {
  id: number
  title: string | null
  hook: string | null
  body: string | null
  cta: string | null
  visualStyle: string | null
  whyViral: string | null
  sourceUrl: string | null
  thumbnailUrl: string | null
  platform: string | null
  tags: string[]
  language: string | null
  mediaType: string | null
  app?: { id: number; name: string } | null
}): IdeaExportPayload & { zavodId: number } {
  const description = [idea.hook, idea.body, idea.cta]
    .filter(Boolean)
    .join('\n\n')

  return {
    zavodId: idea.id,
    title: idea.title,
    description: description || null,
    type: idea.mediaType === 'image' ? 'image' : 'video',
    sourceUrl: idea.sourceUrl,
    thumbnailUrl: idea.thumbnailUrl,
    platform: idea.platform,
    tags: idea.tags,
    appId: idea.app?.id ?? null,
    metadata: {
      zavodId: idea.id,
      visualStyle: idea.visualStyle,
      whyViral: idea.whyViral,
      language: idea.language,
    },
  }
}

function mapMcPlatform(platform: string | undefined): 'tiktok' | 'instagram' | 'youtube' | null {
  if (!platform) return null
  const lower = platform.toLowerCase()
  if (lower === 'tiktok') return 'tiktok'
  if (lower === 'instagram') return 'instagram'
  if (lower === 'youtube') return 'youtube'
  return null
}
