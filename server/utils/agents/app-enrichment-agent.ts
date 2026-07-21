/**
 * App Enrichment Agent — AI-нормализация данных приложения из store page.
 * Получает сырые распарсенные данные и формирует scenario-ready контекст.
 */

import type { StoreParsedData, AppScenarioContext, AppCreativeContext } from '~~/shared/types/app'

interface AppEnrichmentInput {
  appName: string
  storeUrl: string
  platform: string
  parsedData: StoreParsedData
  existingDescription?: string
  existingKeywords?: string[]
  geo?: string
  language?: string
}

interface AppEnrichmentResult {
  productName: string
  subtitle: string
  shortDescription: string
  longDescription: string
  developer: string
  categories: string[]
  targetAudience: string
  pricingNotes: string
  featureBullets: string[]
  asoKeywords: string[]
  onboardingSummary: string
  aiSummary: string
  brandTone: string
  visualCues: string
  forbiddenClaims: string[]
  riskyClaims: string[]
  creativeAngles: AppCreativeContext
  transformationPromise: string
  corePain: string
  coreOutcome: string
  scenarioContext: AppScenarioContext
}

const SYSTEM_PROMPT = `Ты — эксперт по мобильным приложениям, маркетингу и креативному контенту.
Твоя задача: проанализировать данные о приложении из app store / google play и создать полный, структурированный контекст для креативной команды, которая будет снимать рекламные видеоролики.

Важно:
- Все ответы на русском языке.
- Все поля обязательны — если данных мало, делай обоснованные предположения на основе категории и описания.
- Не выдумывай конкретные цифры и факты, которых нет в исходных данных.
- forbiddenClaims — реальные ограничения (медицинские обещания, гарантии дохода и т.п.).
- riskyClaims — утверждения, которые можно использовать осторожно.
- creativeAngles — конкретные, применимые идеи для видеоконтента.
- scenarioContext — готовый контекст для AI-генератора сценариев.

Ответь СТРОГО в формате JSON.`

function buildPrompt(input: AppEnrichmentInput): string {
  const pd = input.parsedData

  return `Проанализируй данные приложения и создай полный креативный контекст.

## Исходные данные из ${input.platform === 'app_store' ? 'App Store' : 'Google Play'}

- URL: ${input.storeUrl}
- Название: ${pd.productName || input.appName}
- Подзаголовок: ${pd.subtitle || 'не указан'}
- Описание: ${pd.description || input.existingDescription || 'не указано'}
- Разработчик: ${pd.developer || 'не указан'}
- Категории: ${pd.categories?.join(', ') || 'не указаны'}
- Рейтинг: ${pd.rating || 'не указан'}
- Количество оценок: ${pd.ratingsCount || 'не указано'}
- Цена: ${pd.price || 'не указана'}
- Встроенные покупки: ${pd.inAppPurchases ? 'да' : 'нет/неизвестно'}
- Установки: ${pd.installs || 'не указано'}
- Content rating: ${pd.contentRating || 'не указан'}
- Гео: ${input.geo || 'не указано'}
- Язык: ${input.language || 'русский'}
${input.existingKeywords?.length ? `- Существующие ключевые слова: ${input.existingKeywords.join(', ')}` : ''}

## Требуемый JSON-формат ответа

{
  "productName": "публичное название",
  "subtitle": "подзаголовок / слоган",
  "shortDescription": "1-2 предложения о сути приложения",
  "longDescription": "развёрнутое описание для контент-менеджера (3-5 предложений)",
  "developer": "разработчик/издатель",
  "categories": ["категория1", "категория2"],
  "targetAudience": "описание целевой аудитории",
  "pricingNotes": "модель монетизации (freemium, подписка, IAP и т.п.)",
  "featureBullets": ["фича1", "фича2", "фича3", "фича4", "фича5"],
  "asoKeywords": ["ключ1", "ключ2", ...до 15],
  "onboardingSummary": "типичный сценарий использования и онбординг",
  "aiSummary": "3-4 предложения: суть приложения для AI-генератора сценариев",
  "brandTone": "описание тона бренда (серьёзный, дружелюбный, экспертный и т.п.)",
  "visualCues": "визуальные подсказки для видео: цвета бренда, стиль, настроение",
  "forbiddenClaims": ["запрещённое утверждение 1", ...],
  "riskyClaims": ["рискованное утверждение 1", ...],
  "creativeAngles": {
    "angles": [
      {"angle": "название угла", "description": "описание подхода", "bestFor": "тип контента"},
      ...3-5 углов
    ],
    "integrationHooks": ["способ нативной интеграции 1", "способ 2", ...],
    "emotionalTriggers": ["триггер1", "триггер2", ...]
  },
  "transformationPromise": "до/после: что меняется в жизни пользователя",
  "corePain": "главная боль, которую решает приложение",
  "coreOutcome": "главный результат для пользователя",
  "scenarioContext": {
    "whatItIs": "что это за приложение (1-2 предложения)",
    "problemSolved": "какую проблему решает",
    "transformationImage": "образ трансформации — до/после",
    "nativeIntegration": "как нативно встроить в сюжет видео",
    "creativeAngles": [{"angle": "...", "description": "...", "bestFor": "..."}],
    "avoidClaims": ["..."],
    "riskyClaims": ["..."],
    "brandTone": "тон бренда",
    "visualCues": "визуальные подсказки",
    "featureBullets": ["..."],
    "keywords": ["..."]
  }
}

Ответь ТОЛЬКО JSON-объектом, без markdown и обёрток.`
}

function validate(data: unknown): AppEnrichmentResult {
  const d = data as Record<string, unknown>

  if (
    typeof d.productName !== 'string'
    || typeof d.aiSummary !== 'string'
    || !Array.isArray(d.featureBullets)
    || typeof d.scenarioContext !== 'object'
    || d.scenarioContext === null
  ) {
    throw new Error('Некорректный формат ответа AppEnrichmentAgent')
  }

  return d as unknown as AppEnrichmentResult
}

export async function runAppEnrichmentAgent(input: AppEnrichmentInput): Promise<AppEnrichmentResult> {
  return callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: 4096,
    validate,
  })
}
