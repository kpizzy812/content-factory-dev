/**
 * Subtitle Keyword Agent — определяет ключевые слова в сегментах субтитров.
 *
 * Используется ASS-генератором для пресетов с needsKeywordDetection=true (Hormozi/Beast/
 * Neon/Boxed): помеченные слова получают цветовой акцент + scale-эффект.
 *
 * Использует Anthropic Haiku ($0.25/1M) — стоимость на 30-сек видео ~$0.001. Защищён
 * через requirePaidApisEnabled (внутри callAnthropicAgent), при отключённых платных API
 * выбрасывает ошибку — caller должен ловить и фолбэкаться на эвристику.
 *
 * In-memory LRU-кэш на 100 элементов — повторный rerunVideoStep('assembly') без изменения
 * текста не дёргает API.
 */

import { createHash } from 'node:crypto'
import { callAnthropicAgent } from './call-anthropic'

export interface SubtitleKeywordSegmentInput {
  order: number
  text: string
}

export interface SubtitleKeywordInput {
  segments: SubtitleKeywordSegmentInput[]
  language: string
  maxKeywordsPerSegment?: number
}

export interface SubtitleKeyword {
  word: string
  weight: number
  reason?: string
}

export interface SubtitleKeywordSegmentResult {
  order: number
  keywords: SubtitleKeyword[]
}

export interface SubtitleKeywordResult {
  segments: SubtitleKeywordSegmentResult[]
}

const SYSTEM_PROMPT = `Ты — режиссёр субтитров для коротких видео (TikTok/Reels). Твоя задача — выделить КЛЮЧЕВЫЕ слова в каждом сегменте, которые нужно визуально подчеркнуть (цвет/масштаб).

Правила:
- Выделяй максимум {{MAX}} слов на сегмент (а лучше 1-2).
- Числа, суммы, проценты — почти всегда keyword (weight 0.9+).
- Эмоционально окрашенные слова ("секрет", "бесплатно", "впервые", "никогда", "всегда") — keyword 0.7+.
- Бренды и названия продукта — keyword 0.8.
- Союзы, местоимения, артикли — НЕ keyword.
- weight = насколько критично выделить (0..1).
- word должен быть ТОЧНОЙ копией из text (включая регистр, БЕЗ хвостовой пунктуации).

Отвечай СТРОГО валидным JSON без markdown-обёрток.`

const MAX_CACHE_ENTRIES = 100
const cache = new Map<string, SubtitleKeywordResult>()

function buildPrompt(input: SubtitleKeywordInput, maxPerSeg: number): string {
  const segmentsBlock = input.segments
    .map(s => `${s.order}. "${s.text.replace(/"/g, "'")}"`)
    .join('\n')

  return `Язык: ${input.language}
Лимит: до ${maxPerSeg} keyword на сегмент.

Сегменты:
${segmentsBlock}

Ответ строго в формате:
{
  "segments": [
    { "order": 1, "keywords": [ { "word": "...", "weight": 0.9, "reason": "число" } ] }
  ]
}`
}

function validate(data: unknown): SubtitleKeywordResult {
  if (!data || typeof data !== 'object') {
    throw new Error('Subtitle keyword agent: ответ не объект')
  }
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.segments)) {
    throw new Error('Subtitle keyword agent: поле segments должно быть массивом')
  }

  const segments: SubtitleKeywordSegmentResult[] = []
  for (const raw of d.segments) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const order = typeof r.order === 'number' ? r.order : Number(r.order)
    if (!Number.isFinite(order)) continue
    const keywords: SubtitleKeyword[] = []
    if (Array.isArray(r.keywords)) {
      for (const k of r.keywords) {
        if (!k || typeof k !== 'object') continue
        const kk = k as Record<string, unknown>
        const word = typeof kk.word === 'string' ? kk.word.trim() : ''
        if (!word) continue
        const weightRaw = typeof kk.weight === 'number' ? kk.weight : Number(kk.weight)
        const weight = Number.isFinite(weightRaw)
          ? Math.max(0, Math.min(1, weightRaw))
          : 0.5
        const reason = typeof kk.reason === 'string' ? kk.reason : undefined
        keywords.push({ word, weight, reason })
      }
    }
    segments.push({ order, keywords })
  }
  return { segments }
}

function cacheKey(input: SubtitleKeywordInput): string {
  const minimal = {
    s: input.segments.map(s => ({ o: s.order, t: s.text })),
    l: input.language,
    m: input.maxKeywordsPerSegment ?? 2,
  }
  return createHash('sha256').update(JSON.stringify(minimal)).digest('hex')
}

function setCache(key: string, value: SubtitleKeywordResult): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // LRU-light: удаляем самый старый (Map хранит порядок вставки).
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, value)
}

/**
 * Запускает Haiku-агент на массиве сегментов. При выключенных paid-apis или ошибке API —
 * выбрасывает исключение, caller должен ловить и фолбэкаться на эвристику.
 */
export async function runSubtitleKeywordAgent(
  input: SubtitleKeywordInput,
): Promise<SubtitleKeywordResult> {
  if (!input.segments || input.segments.length === 0) {
    return { segments: [] }
  }
  const maxPerSeg = input.maxKeywordsPerSegment ?? 2
  const key = cacheKey(input)
  const cached = cache.get(key)
  if (cached) {
    // Move-to-end для квази-LRU поведения.
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const result = await callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT.replace('{{MAX}}', String(maxPerSeg)),
    userPrompt: buildPrompt(input, maxPerSeg),
    tier: 'haiku',
    maxTokens: 1024,
    validate,
  })

  setCache(key, result)
  return result
}
