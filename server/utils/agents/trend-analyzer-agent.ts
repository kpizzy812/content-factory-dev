/**
 * Trend Analyzer Agent — комплексный AI-анализ найденного креатива.
 * 4 аналитических блока: hook, scene structure, visual style, virality reasons.
 * Результат сохраняется как CreativeBrief.
 */
import type { TrendAnalysisInput, TrendAnalysisResult } from '~~/shared/types/agents'

const PROMPT_VERSION = '1.0.0'

const SYSTEM_PROMPT = `Ты — эксперт по анализу вирусного видеоконтента в социальных сетях (TikTok, Instagram Reels, YouTube Shorts).

Твоя задача — провести глубокий структурированный анализ видеоконтента по 4 направлениям:
1. Hook (зацеп) — как видео удерживает внимание в первые 1-3 секунды
2. Scene Structure (структура сцен) — как построен нарратив и монтаж
3. Visual Style (визуальный стиль) — цветовая палитра, ракурсы, эффекты
4. Virality Reasons (причины вирусности) — почему контент стал популярным

Анализируй на основе предоставленных данных: заголовок, описание, хештеги, метрики, платформу, автора.
Если видео недоступно напрямую, анализируй по метаданным и описанию — это допустимо и полезно.

Отвечай на русском. Отвечай СТРОГО в формате JSON.`

function buildPrompt(input: TrendAnalysisInput): string {
  const metrics = [
    input.viewCount != null ? `Просмотры: ${input.viewCount.toLocaleString('ru')}` : null,
    input.likeCount != null ? `Лайки: ${input.likeCount.toLocaleString('ru')}` : null,
    input.commentCount != null ? `Комментарии: ${input.commentCount.toLocaleString('ru')}` : null,
    input.shareCount != null ? `Репосты: ${input.shareCount.toLocaleString('ru')}` : null,
  ].filter(Boolean).join(', ')

  const engagementRate = input.viewCount && input.viewCount > 0
    ? (((input.likeCount || 0) + (input.commentCount || 0)) / input.viewCount * 100).toFixed(2)
    : null

  return `Проанализируй этот вирусный креатив.

## Данные креатива
- Платформа: ${input.platform}
- Заголовок: ${input.title}
${input.description ? `- Описание: ${input.description}` : ''}
${input.authorName ? `- Автор: ${input.authorName}` : ''}
${input.hashtags?.length ? `- Хештеги: ${input.hashtags.map(t => '#' + t).join(' ')}` : ''}
${metrics ? `- Метрики: ${metrics}` : ''}
${engagementRate ? `- Engagement Rate: ${engagementRate}%` : ''}
${input.publishedAt ? `- Дата публикации: ${input.publishedAt}` : ''}
${input.language ? `- Язык: ${input.language}` : ''}
${input.geo ? `- Гео: ${input.geo}` : ''}
${input.thumbnailUrl ? `- Thumbnail: ${input.thumbnailUrl}` : ''}
${input.sourceUrl ? `- URL: ${input.sourceUrl}` : ''}

## Задача
Верни JSON-объект со следующей структурой:

{
  "hookAnalysis": {
    "type": "question|shock|story|controversy|pain_point|promise|visual|sound|text_overlay",
    "description": "описание хука — что именно цепляет в первые секунды",
    "strength": число 1-100,
    "textOnScreen": "текст на экране в хуке, если применимо",
    "emotionalTrigger": "основной эмоциональный триггер"
  },
  "sceneStructure": {
    "estimatedDuration": "оценка длительности (напр. 15s, 30s, 60s)",
    "scenes": [
      {
        "order": 1,
        "name": "название сцены",
        "description": "что происходит",
        "estimatedDuration": "примерная длительность",
        "purpose": "зачем эта сцена нужна"
      }
    ],
    "narrativeArc": "тип нарратива: tutorial|transformation|storytime|reaction|challenge|comparison|day_in_life",
    "pacingNotes": "заметки по темпу монтажа"
  },
  "visualStyle": {
    "colorTone": "описание цветовой гаммы",
    "lighting": "описание освещения",
    "cameraWork": "описание работы камеры",
    "textOverlays": true/false,
    "effects": ["список эффектов/переходов"],
    "aesthetic": "общий визуальный стиль (minimal|bright|dark|cinematic|lo-fi|professional)"
  },
  "viralityReasons": {
    "primaryReason": "главная причина вирусности",
    "factors": [
      {
        "factor": "название фактора",
        "description": "описание",
        "impact": "high|medium|low"
      }
    ],
    "targetAudience": "описание целевой аудитории",
    "replicability": число 1-100,
    "replicabilityNotes": "что нужно для воспроизведения успеха"
  },
  "summary": "краткое резюме анализа в 2-3 предложениях",
  "confidence": число 0.0-1.0
}

Ответь ТОЛЬКО JSON-объектом, без markdown-обёрток.`
}

function validate(data: unknown): TrendAnalysisResult {
  const d = data as Record<string, unknown>

  if (!d.hookAnalysis || typeof d.hookAnalysis !== 'object') {
    throw new Error('Отсутствует или некорректный hookAnalysis')
  }
  if (!d.sceneStructure || typeof d.sceneStructure !== 'object') {
    throw new Error('Отсутствует или некорректный sceneStructure')
  }
  if (!d.visualStyle || typeof d.visualStyle !== 'object') {
    throw new Error('Отсутствует или некорректный visualStyle')
  }
  if (!d.viralityReasons || typeof d.viralityReasons !== 'object') {
    throw new Error('Отсутствует или некорректный viralityReasons')
  }
  if (typeof d.summary !== 'string' || d.summary.length === 0) {
    throw new Error('Отсутствует summary')
  }

  return d as unknown as TrendAnalysisResult
}

export async function runTrendAnalyzer(input: TrendAnalysisInput): Promise<TrendAnalysisResult> {
  return callAnthropicAgent({
    agentName: 'trend-analyzer',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: 4096,
    validate,
  })
}

export { PROMPT_VERSION }
