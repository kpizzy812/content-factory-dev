/**
 * Генерация сценариев — обёртка над scenario-pipeline.
 * Использует CreativeBrief как primary source, TrendInsight как fallback.
 * v3: передаёт app context, profileSettings и appId для story-driven pipeline.
 */

import type { GeneratedVariant, ScenarioInput } from './agents/scenario-pipeline'
import { generateScenarioVariants } from './agents/scenario-pipeline'

interface TrendData {
  title: string
  description?: string | null
  platform: string
  hashtags: string[]
  viewCount: number
  insights: Array<{
    whyViral: string
    patterns: string[]
    hooks: string[]
    audience?: string | null
  }>
  brief?: {
    hookAnalysis: unknown
    sceneStructure: unknown
    visualStyle: unknown
    viralityReasons: unknown
    summary: string
  } | null
  /** Reference analysis breakdown for reference-driven generation */
  referenceBreakdown?: Record<string, unknown>
}

interface AppData {
  name: string
  description?: string | null
  keywords: string[]
  transformationPromise?: string | null
  corePain?: string | null
  coreOutcome?: string | null
  creativeAngles?: unknown
  scenarioContext?: unknown
  referenceImageUrls?: string[]
}

export interface FavoritePromptsSelection {
  manualIds?: number[]
  autoSelect?: boolean
}

export async function generateScenarios(
  trend: TrendData,
  app: AppData,
  variantsCount?: number,
  appId?: number | null,
  profileSettings?: ScenarioInput['profileSettings'],
  favoritePrompts?: FavoritePromptsSelection,
): Promise<GeneratedVariant[]> {
  // AI-разметка скриншотов приложения. Используется scene planner для решения,
  // надо ли привязать сцену к конкретному скриншоту (image-to-video Kling).
  // Если AI-анализ ещё не прогнался — фильтруем по analyzedAt; пустые AppReferenceImage
  // не попадут в промпт и appScreenRef в этой сессии останется null.
  let appReferenceScreens: ScenarioInput['appReferenceScreens'] = []
  if (appId) {
    try {
      const records = await prisma.appReferenceImage.findMany({
        where: { appId, aiAnalyzedAt: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 12,
      })
      appReferenceScreens = records.map(r => ({
        id: r.id,
        fileUrl: r.fileUrl,
        tags: r.aiTags ?? [],
        caption: r.aiCaption,
        primaryAction: r.aiPrimaryAction,
        hasUI: r.aiHasUI,
        analyzedAt: r.aiAnalyzedAt?.toISOString() ?? null,
      }))
    } catch { /* non-critical, fall back to empty list */ }
  }

  const input: ScenarioInput = {
    trendTitle: trend.title,
    trendDescription: trend.description,
    platform: trend.platform,
    hashtags: trend.hashtags,
    viewCount: trend.viewCount,
    brief: trend.brief as ScenarioInput['brief'],
    insights: trend.insights,
    appName: app.name,
    appDescription: app.description,
    appKeywords: app.keywords,
    variantsCount: variantsCount || 3,
    // v3 extensions
    appId: appId ?? null,
    appContext: {
      transformationPromise: app.transformationPromise,
      corePain: app.corePain,
      coreOutcome: app.coreOutcome,
      creativeAngles: app.creativeAngles,
      scenarioContext: app.scenarioContext,
      referenceImageUrls: app.referenceImageUrls ?? [],
    },
    appReferenceScreens,
    profileSettings: profileSettings ?? null,
    // Reference-driven generation
    referenceBreakdown: trend.referenceBreakdown ?? null,
    // Favorite prompts
    favoritePromptIds: favoritePrompts?.manualIds,
    favoritePromptsAutoSelect: favoritePrompts?.autoSelect,
  }

  return generateScenarioVariants(input)
}
