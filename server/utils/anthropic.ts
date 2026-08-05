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
  /**
   * Язык контента. Поле обязательное намеренно: когда оно было
   * необязательным, три из четырёх мест вызова его не передавали, а агенты
   * трактуют undefined как English и пишут сценарий не на том языке.
   */
  language: string | null
  /**
   * Активная воронка юнита. Если задана — CTA зовёт отправить кодовое слово
   * в директ, а не установить приложение.
   */
  funnel?: ScenarioInput['funnel']
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

/**
 * Ведущий юнита и статистика его живых фрагментов. Протагонист приоритетнее
 * остальных персонажей — тем же правилом выбирается ведущий при запуске видео.
 */
async function loadPresenterForApp(appId: number): Promise<ScenarioInput['presenter']> {
  try {
    const withClips = {
      appId,
      archived: false,
      sourceClips: { some: { isActive: true } },
    }
    const character = await prisma.character.findFirst({
      where: { ...withClips, role: 'protagonist' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    }) ?? await prisma.character.findFirst({
      where: withClips,
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    })
    if (!character) return null

    const stats = await prisma.presenterSourceClip.aggregate({
      where: { characterId: character.id, isActive: true },
      _count: { _all: true },
      _min: { durationSec: true },
      _max: { durationSec: true },
    })
    const clipCount = stats._count._all
    if (clipCount === 0) return null

    return {
      name: character.name,
      clipCount,
      minClipSec: stats._min.durationSec ?? 2,
      maxClipSec: stats._max.durationSec ?? 10,
    }
  } catch {
    // Разметка ведущего — не критичный контекст: без неё сценарий просто
    // получится полностью закадровым, а не упадёт.
    return null
  }
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

  // Живая библиотека ведущего. Пока она пуста, планировщику незачем размечать
  // сцены под lip-sync: играть в кадре некому.
  const presenter = appId ? await loadPresenterForApp(appId) : null

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
    language: app.language,
    funnel: app.funnel ?? null,
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
    presenter,
    profileSettings: profileSettings ?? null,
    // Reference-driven generation
    referenceBreakdown: trend.referenceBreakdown ?? null,
    // Favorite prompts
    favoritePromptIds: favoritePrompts?.manualIds,
    favoritePromptsAutoSelect: favoritePrompts?.autoSelect,
  }

  return generateScenarioVariants(input)
}
