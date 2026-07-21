/**
 * Keyword Agent — генерация хештегов и ключевых слов для контента.
 * Учитывает специфику каждой платформы.
 */
import type { KeywordAgentInput, KeywordAgentResult } from '~~/shared/types/agents'

const SYSTEM_PROMPT = `Ты — эксперт по контент-стратегии и SEO для коротких видео. Знаешь специфику хештегов: TikTok — до 5 точных, Instagram — до 30 (микс популярных и нишевых), YouTube — meta-теги и теги в описании. Отвечай на русском. Отвечай СТРОГО в формате JSON.`

function buildPrompt(input: KeywordAgentInput): string {
  const platformsText = input.platforms?.length
    ? input.platforms.join(', ')
    : 'TikTok, Instagram, YouTube'

  return `Сгенерируй хештеги и ключевые слова для продвижения контента.

## Приложение
- Название: ${input.appName}
- Описание: ${input.appDescription || 'не указано'}
- Ниша: ${input.niche || 'не определена'}

## Параметры
- Гео: ${input.geo || 'Россия'}
- Язык: ${input.language || 'русский'}
- Платформы: ${platformsText}

## Задача
Сгенерируй JSON-объект:
- semanticTags: массив из 10-15 семантических тегов (точно описывают тему)
- viralTags: массив из 5-10 трендовых/вирусных тегов
- nicheTags: массив из 5-10 нишевых тегов (маленькие, но целевые)
- searchKeywords: массив из 5-8 ключевых фраз для SEO
- confidence: число 0-100 (уверенность в релевантности)
- reasoning: строка — краткое объяснение стратегии

Ответь ТОЛЬКО JSON-объектом, без обёрток.`
}

function validate(data: unknown): KeywordAgentResult {
  const d = data as Record<string, unknown>

  if (
    !Array.isArray(d.semanticTags)
    || !Array.isArray(d.viralTags)
    || !Array.isArray(d.nicheTags)
    || !Array.isArray(d.searchKeywords)
    || typeof d.confidence !== 'number'
    || typeof d.reasoning !== 'string'
  ) {
    throw new Error('Некорректный формат ответа KeywordAgent')
  }

  return d as unknown as KeywordAgentResult
}

export async function runKeywordAgent(input: KeywordAgentInput): Promise<KeywordAgentResult> {
  return callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    tier: 'haiku',
    maxTokens: 2048,
    validate,
  })
}
