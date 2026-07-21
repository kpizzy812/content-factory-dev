/**
 * Idea Analyzer Agent — структурированный AI-анализ видео на основе реальных метаданных.
 * Переиспользует формат CreativeBrief из Trendwatcher:
 *   hookAnalysis, sceneStructure, visualStyle, viralityReasons, summary.
 *
 * ВАЖНО: анализ основан на реальных данных (заголовок, описание, автор, хештеги),
 * а не на URL-строке. AI не может смотреть видео — он анализирует метаданные.
 */
import type { TrendAnalysisResult } from '~~/shared/types/agents'

const PROMPT_VERSION = '1.1.0'

const SYSTEM_PROMPT = `Ты — эксперт по анализу вирусного видеоконтента в социальных сетях (TikTok, Instagram Reels, YouTube Shorts).

Твоя задача — провести глубокий структурированный анализ видеоконтента по 4 направлениям:
1. Hook (зацеп) — как видео удерживает внимание в первые 1-3 секунды
2. Scene Structure (структура сцен) — как построен нарратив и монтаж
3. Visual Style (визуальный стиль) — цветовая палитра, ракурсы, эффекты
4. Virality Reasons (причины вирусности) — почему контент стал популярным

КРИТИЧНО:
- Анализируй ТОЛЬКО на основе предоставленных метаданных (заголовок, описание, автор, хештеги).
- НЕ выдумывай визуальные детали, которых нет в данных.
- Если данных недостаточно, честно укажи confidence ниже и отметь ограничения в summary.
- Для scene structure и visual style делай ОБОСНОВАННЫЕ предположения на основе платформы и жанра, если данных мало — указывай это.

Отвечай на указанном языке. Отвечай СТРОГО в формате JSON.`

export interface IdeaAnalysisInput {
  sourceUrl: string
  platform: string | null
  title: string | null
  description: string | null
  authorName: string | null
  hashtags: string[]
  transcription: string | null
  language: string
}

function buildPrompt(input: IdeaAnalysisInput): string {
  const parts: string[] = []
  parts.push(`- URL: ${input.sourceUrl}`)
  if (input.platform) parts.push(`- Платформа: ${input.platform}`)
  if (input.title) parts.push(`- Заголовок: ${input.title}`)
  if (input.description) parts.push(`- Описание: ${input.description}`)
  if (input.authorName) parts.push(`- Автор: ${input.authorName}`)
  if (input.hashtags.length > 0) parts.push(`- Хештеги: ${input.hashtags.map(t => '#' + t).join(' ')}`)
  if (input.transcription) parts.push(`- Дополнительные данные:\n${input.transcription.slice(0, 3000)}`)

  return `Проанализируй видеоконтент на основе реальных метаданных.

## Метаданные видео
${parts.join('\n')}

## Язык ответа
${input.language}

## Задача
Верни JSON-объект со следующей структурой:

{
  "hookAnalysis": {
    "type": "question|shock|story|controversy|pain_point|promise|visual|sound|text_overlay",
    "description": "описание хука — на основе заголовка и описания, что цепляет",
    "strength": число 1-100,
    "textOnScreen": "текст на экране если упоминается, или null",
    "emotionalTrigger": "основной эмоциональный триггер"
  },
  "sceneStructure": {
    "estimatedDuration": "оценка длительности",
    "scenes": [
      {
        "order": 1,
        "name": "название сцены",
        "description": "что происходит (на основе описания/заголовка)",
        "estimatedDuration": "примерная длительность",
        "purpose": "зачем эта сцена нужна"
      }
    ],
    "narrativeArc": "тип нарратива: tutorial|transformation|storytime|reaction|challenge|comparison|day_in_life",
    "pacingNotes": "заметки по темпу"
  },
  "visualStyle": {
    "colorTone": "описание цветовой гаммы (предположение на основе платформы/жанра)",
    "lighting": "описание освещения",
    "cameraWork": "описание работы камеры",
    "textOverlays": true/false,
    "effects": ["список эффектов"],
    "aesthetic": "minimal|bright|dark|cinematic|lo-fi|professional"
  },
  "viralityReasons": {
    "primaryReason": "главная причина вирусности (на основе хештегов, описания)",
    "factors": [
      {
        "factor": "название фактора",
        "description": "описание",
        "impact": "high|medium|low"
      }
    ],
    "targetAudience": "описание целевой аудитории",
    "replicability": число 1-100,
    "replicabilityNotes": "что нужно для воспроизведения"
  },
  "summary": "краткое резюме в 2-3 предложениях, включая КАКИЕ данные были доступны для анализа",
  "confidence": число 0.0-1.0 (ниже если метаданных мало)
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

export async function runIdeaAnalyzer(input: IdeaAnalysisInput): Promise<TrendAnalysisResult> {
  return callAnthropicAgent({
    agentName: 'idea-analyzer',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: 4096,
    validate,
  })
}

export { PROMPT_VERSION as IDEA_ANALYZER_PROMPT_VERSION }
