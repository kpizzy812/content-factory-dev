/**
 * App Context Helper — формирует scenario-ready контекст приложения.
 * Используется AI-агентами, pipeline нодами и автозаполнением сценариев.
 */

import type { AppScenarioContext } from '~~/shared/types/app'

interface AppRecord {
  id: number
  name: string
  description?: string | null
  keywords: string[]
  geo?: string | null
  language?: string | null
  productName?: string | null
  subtitle?: string | null
  longDescription?: string | null
  developer?: string | null
  categories: string[]
  targetAudience?: string | null
  pricingNotes?: string | null
  featureBullets: string[]
  asoKeywords: string[]
  onboardingSummary?: string | null
  aiSummary?: string | null
  brandTone?: string | null
  visualCues?: string | null
  forbiddenClaims: string[]
  riskyClaims: string[]
  creativeAngles?: unknown
  transformationPromise?: string | null
  corePain?: string | null
  coreOutcome?: string | null
  scenarioContext?: unknown
  referenceImageUrls?: string[]
}

/**
 * Загружает приложение из БД и возвращает scenario-ready контекст.
 */
export async function getAppScenarioContext(appId: number): Promise<AppScenarioContext | null> {
  const app = await prisma.app.findUnique({
    where: { id: appId },
  })

  if (!app) return null
  return buildAppScenarioContext(app as unknown as AppRecord)
}

/**
 * Формирует scenario-ready контекст из записи App.
 * Если есть сохранённый scenarioContext — возвращает его.
 * Иначе собирает из отдельных полей (graceful degradation).
 */
export function buildAppScenarioContext(app: AppRecord): AppScenarioContext {
  const referenceImageUrls = app.referenceImageUrls || []

  // Если есть готовый AI-сгенерированный контекст — используем его (но referenceImageUrls
  // всегда берём актуальные из App, т.к. они меняются независимо от scenarioContext).
  const saved = app.scenarioContext as AppScenarioContext | null
  if (saved && typeof saved === 'object' && 'whatItIs' in saved) {
    return { ...saved, referenceImageUrls }
  }

  // Fallback: собираем из отдельных полей
  const creativeCtx = app.creativeAngles as { angles?: Array<{ angle: string; description: string; bestFor: string }> } | null

  return {
    whatItIs: app.aiSummary
      || app.subtitle
      || app.description
      || `${app.productName || app.name} — мобильное приложение`,
    problemSolved: app.corePain || 'не определена',
    transformationImage: app.transformationPromise || 'не определён',
    nativeIntegration: app.onboardingSummary || 'стандартная интеграция через демонстрацию',
    creativeAngles: creativeCtx?.angles || [],
    avoidClaims: app.forbiddenClaims || [],
    riskyClaims: app.riskyClaims || [],
    brandTone: app.brandTone || 'нейтральный',
    visualCues: app.visualCues || '',
    featureBullets: app.featureBullets || [],
    keywords: [...(app.asoKeywords || []), ...(app.keywords || [])],
    referenceImageUrls,
  }
}

/**
 * Формирует текстовый блок для вставки в промпт AI-агента.
 * Удобно для scenario-pipeline и других агентов.
 */
export function formatAppContextForPrompt(ctx: AppScenarioContext): string {
  const lines = [
    `## Приложение`,
    `- Суть: ${ctx.whatItIs}`,
    `- Проблема: ${ctx.problemSolved}`,
    `- Трансформация: ${ctx.transformationImage}`,
    `- Интеграция в сюжет: ${ctx.nativeIntegration}`,
    `- Тон бренда: ${ctx.brandTone}`,
  ]

  if (ctx.featureBullets.length > 0) {
    lines.push(`- Ключевые фичи: ${ctx.featureBullets.join('; ')}`)
  }

  if (ctx.creativeAngles.length > 0) {
    lines.push(`- Креативные углы: ${ctx.creativeAngles.map(a => `${a.angle} (${a.description})`).join('; ')}`)
  }

  if (ctx.avoidClaims.length > 0) {
    lines.push(`- ИЗБЕГАТЬ утверждений: ${ctx.avoidClaims.join('; ')}`)
  }

  if (ctx.riskyClaims.length > 0) {
    lines.push(`- Осторожно с: ${ctx.riskyClaims.join('; ')}`)
  }

  if (ctx.visualCues) {
    lines.push(`- Визуальные подсказки: ${ctx.visualCues}`)
  }

  if (ctx.referenceImageUrls && ctx.referenceImageUrls.length > 0) {
    lines.push(`- Reference-изображения (визуальные эталоны приложения, при возможности используй их как референсы для стиля/героев/объектов):`)
    for (const url of ctx.referenceImageUrls) {
      lines.push(`  • ${url}`)
    }
  }

  return lines.join('\n')
}
