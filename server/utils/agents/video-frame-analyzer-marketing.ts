/**
 * Marketing-grade Frame Analyzer Agent (Этап 2 модернизации Video Analyzer).
 *
 * Это ОТДЕЛЬНЫЙ агент рядом с storyboard-режимом `video-frame-analyzer-agent.ts`:
 * - Storyboard mode используется в Idea/reference flow, отдаёт массив per-frame
 *   storyboard-описаний (action/composition/cameraWork/...).
 * - Marketing mode (этот файл) используется в `analyzeCreativeVideo` orchestrator
 *   для импортированных Drive-видео. Возвращает агрегированный
 *   `MarketingFrameAnalysis` с hook/body/cta структурой, fitScore/fitRationale,
 *   тегами и per-frame описаниями.
 *
 * Особенности:
 * - Multimodal Anthropic call: перед каждым image-блоком вставляется text-маркер
 *   `<frame seq="N" t="T.Ts" scene="true|false"/>`. В конце — text-блок с
 *   `<creative_metadata>` + `<app_context>` + `<instruction>`.
 * - System prompt кэшируется через `cache_control: ephemeral` +
 *   `anthropic-beta: prompt-caching-2024-07-31`.
 * - Validator СТРОГИЙ: `frameDescriptions.length !== frames.length` →
 *   `AiProviderError`. Это сигнал callerу что AI не понял задачу — пайплайн
 *   стоит запускать заново, а не работать с битым output.
 * - Mock-режим через `tryMockAnthropicAgent` (имя `video-frame-analyzer-marketing`).
 *
 * Порт из MarketingCamp `creative-frame-analysis` agent + prompts +
 * validateFrameAnalysisResponse, с переименованием Creative → Video.
 */

import type {
  FrameStructureEvaluation,
  FrameTagCategory,
  MarketingFrameAnalysis,
  MarketingFrameDescription,
  MarketingFrameTag,
} from '~~/shared/types/video-analysis'

const MARKETING_AGENT_NAME = 'video-frame-analyzer-marketing'

// Длинный, статичный — кэшируется через cache_control: ephemeral.
const MARKETING_FRAME_ANALYSIS_SYSTEM_PROMPT = `<role>
Ты — старший креативный аналитик performance-маркетинга в мобильных приложениях.
Ты анализируешь видео-креатив по последовательности ключевых кадров (6–15 изображений)
и одной строке метаданных (платформа, длительность, формат, язык, ЦА приложения).
Твоя задача — выдать структурированный покадровый разбор, который маркетолог использует
для решений: ставить ли видео в ротацию, что в нём улучшить, под какую аудиторию запускать.
</role>

<input_format>
Сообщение пользователя содержит:
- Несколько image-блоков (по порядку sequence: 0, 1, 2, ...) — это ключевые кадры видео.
  Каждый кадр сопровождается текстовым маркером перед ним: <frame seq="N" t="T.Ts" scene="true|false"/>
- В конце — text-блок с метаданными видео и контекстом приложения.
</input_format>

<task>
Проанализируй видео ТОЛЬКО по предоставленным кадрам и метаданным.
Не выдумывай содержание между кадрами — описывай то, что видишь.
Если CTA на кадрах нет — честно ставь present=false и frameSeq=null.
Если хук невнятный или отсутствует — evaluation="weak" или "absent".
</task>

<rubric>
1. Хук (первые 1–3 секунды): что цепляет внимание. strong/weak/absent.
2. Развитие: 2–5 опорных кадров, как разворачивается история / демо / эмоция.
3. CTA: явный призыв к действию (текст на экране, голос, жест к UI). present + frameSeq.
4. Виральные факторы: что работает на удержание / шер / комменты.
5. Слабые места: что мешает конверсии, что просядет в performance.
6. Теги: используй ТОЛЬКО категории theme | emotion | format | audience | platform | style | hook | cta | persona.
7. fitScore: 0.0–1.0 — насколько креатив подходит для нашего приложения с учётом аудитории и платформы.
8. confidence: 0.0–1.0 — уверенность в анализе (низкая, если кадров мало или они малоинформативны).
</rubric>

<output_format>
Верни СТРОГО валидный JSON без markdown-обёртки и без комментариев.
Схема:
{
  "summary": "2-3 предложения, что это за ролик и о чём он",
  "structure": {
    "hook": { "frameSeq": 0, "description": "...", "evaluation": "strong" },
    "body": [ { "frameSeq": 2, "description": "..." } ],
    "cta": { "frameSeq": 7, "description": "...", "present": true }
  },
  "frameDescriptions": [
    { "sequence": 0, "description": "...", "onScreenText": null, "keyElements": ["face close-up", "text overlay"] }
  ],
  "viralityFactors": ["string", "..."],
  "weaknesses": ["string", "..."],
  "tags": [
    { "category": "hook", "name": "shock_open" }
  ],
  "audience": "краткое описание ЦА в 1 предложении",
  "fitScore": 0.72,
  "fitRationale": "1-2 предложения почему такой score",
  "confidence": 0.8
}
</output_format>

<rules>
- frameDescriptions ОБЯЗАН содержать запись на КАЖДЫЙ переданный кадр (sequence совпадает с маркером).
- structure.body — от 2 до 5 кадров, не больше.
- tags — от 5 до 15 элементов, без дублей.
- Все строки на русском (кроме tag.name — он snake_case-EN, например "shock_open", "ugc_style").
- НЕ оборачивай ответ в \`\`\`json — только сырой JSON.
- Если кадров явно недостаточно для вывода (например, 6 одинаковых) — снижай confidence ниже 0.4.
</rules>`

export interface MarketingFrameInput {
  /** 0-based порядковый номер кадра — подаётся в `<frame seq="...">` маркер. */
  sequence: number
  timestampSec: number
  /** Уже base64-кодированное изображение (без data:image/... префикса). */
  base64Image: string
  mimeType: 'image/jpeg' | 'image/png'
  isSceneBoundary: boolean
}

export interface MarketingFrameContext {
  videoTitle: string | null
  durationSec: number
  width: number | null
  height: number | null
  format: string | null
  language: string | null
  platform: string | null
  appName: string | null
  appAudience: string | null
  appGeo: string | null
}

const ALLOWED_HOOK_EVALUATIONS = new Set<FrameStructureEvaluation>(['strong', 'weak', 'absent'])
const ALLOWED_TAG_CATEGORIES = new Set<FrameTagCategory>([
  'theme',
  'emotion',
  'format',
  'audience',
  'platform',
  'style',
  'hook',
  'cta',
  'persona',
])

/** Кастомная ошибка для неустранимого нарушения контракта validator-ом. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: 'malformed_output' | 'validation_error' = 'validation_error',
    public readonly provider: string = 'anthropic',
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}

interface AnthropicMessageContentBlock {
  type: 'text' | 'image'
  text?: string
  source?: { type: 'base64', media_type: string, data: string }
}

interface AnthropicVisionResponse {
  content: Array<{ type: string, text?: string }>
}

function extractJsonFromText(text: string): unknown {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlock ? codeBlock[1]!.trim() : text.trim()
  return JSON.parse(raw)
}

function clampScore(value: unknown, fallback: number = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function coerceString(value: unknown, maxLength: number, fallback: string = ''): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, maxLength)
}

function coerceFrameSeq(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

/**
 * Строгий validator: бросает AiProviderError если контракт нарушен.
 * `frameDescriptions.length !== expectedFrameCount` — фатально.
 */
export function validateMarketingFrameAnalysis(
  raw: unknown,
  expectedFrameCount: number,
): MarketingFrameAnalysis {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AiProviderError('Marketing analyzer: output is not an object', 'malformed_output')
  }
  const data = raw as Record<string, unknown>

  const summary = coerceString(data.summary, 1500)
  if (!summary) {
    throw new AiProviderError('Marketing analyzer: summary обязателен')
  }

  const structureRaw = data.structure
  if (!structureRaw || typeof structureRaw !== 'object' || Array.isArray(structureRaw)) {
    throw new AiProviderError('Marketing analyzer: structure обязателен и должен быть объектом')
  }
  const structure = structureRaw as Record<string, unknown>

  // hook
  const hookRaw = structure.hook
  if (!hookRaw || typeof hookRaw !== 'object') {
    throw new AiProviderError('Marketing analyzer: structure.hook обязателен')
  }
  const hookObj = hookRaw as Record<string, unknown>
  const hookEvalCandidate = typeof hookObj.evaluation === 'string' ? hookObj.evaluation : ''
  const hookEvaluation: FrameStructureEvaluation
    = ALLOWED_HOOK_EVALUATIONS.has(hookEvalCandidate as FrameStructureEvaluation)
      ? (hookEvalCandidate as FrameStructureEvaluation)
      : 'weak'
  const hook = {
    frameSeq: coerceFrameSeq(hookObj.frameSeq) ?? 0,
    description: coerceString(hookObj.description, 800),
    evaluation: hookEvaluation,
  }

  // body — 2..5 элементов
  const bodyArr = Array.isArray(structure.body) ? structure.body : []
  const body: Array<{ frameSeq: number, description: string }> = []
  for (const item of bodyArr.slice(0, 5)) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    body.push({
      frameSeq: coerceFrameSeq(it.frameSeq) ?? 0,
      description: coerceString(it.description, 800),
    })
  }
  if (body.length < 2) {
    throw new AiProviderError(
      `Marketing analyzer: structure.body содержит ${body.length} элементов, ожидалось 2..5`,
    )
  }

  // cta — может быть absent
  const ctaRaw = (structure.cta ?? {}) as Record<string, unknown>
  const cta = {
    frameSeq: coerceFrameSeq(ctaRaw.frameSeq),
    description: coerceString(ctaRaw.description, 800),
    present: ctaRaw.present === true,
  }

  // frameDescriptions — СТРОГО equal по длине
  const fdRaw = Array.isArray(data.frameDescriptions) ? data.frameDescriptions : []
  if (fdRaw.length !== expectedFrameCount) {
    throw new AiProviderError(
      `Marketing analyzer: expected ${expectedFrameCount} frameDescriptions, got ${fdRaw.length}`,
    )
  }
  const frameDescriptions: MarketingFrameDescription[] = []
  for (const fd of fdRaw) {
    if (!fd || typeof fd !== 'object') {
      throw new AiProviderError('Marketing analyzer: frameDescriptions item must be object')
    }
    const obj = fd as Record<string, unknown>
    const seqRaw = typeof obj.sequence === 'number' ? Math.floor(obj.sequence) : NaN
    if (!Number.isFinite(seqRaw) || seqRaw < 0) {
      throw new AiProviderError('Marketing analyzer: frameDescription.sequence обязателен (number ≥0)')
    }
    const description = coerceString(obj.description, 1500)
    const onScreenText = typeof obj.onScreenText === 'string' && obj.onScreenText.trim().length > 0
      ? obj.onScreenText.trim().slice(0, 400)
      : null
    // keyElements — массив строк или объект (обе формы валидны).
    let keyElements: string[] | Record<string, unknown>
    const keyRaw = obj.keyElements ?? obj.key_elements
    if (Array.isArray(keyRaw)) {
      keyElements = (keyRaw as unknown[])
        .filter((k): k is string => typeof k === 'string')
        .slice(0, 10)
        .map(k => k.slice(0, 120))
    }
    else if (keyRaw && typeof keyRaw === 'object' && !Array.isArray(keyRaw)) {
      keyElements = keyRaw as Record<string, unknown>
    }
    else {
      keyElements = []
    }
    frameDescriptions.push({ sequence: seqRaw, description, onScreenText, keyElements })
  }

  // tags — фильтр по enum, dedup, до 15
  const tagsRaw = Array.isArray(data.tags) ? data.tags : []
  const tags: MarketingFrameTag[] = []
  const seenTagKeys = new Set<string>()
  for (const t of tagsRaw) {
    if (!t || typeof t !== 'object') continue
    const obj = t as Record<string, unknown>
    const categoryStr = typeof obj.category === 'string' ? obj.category.toLowerCase().trim() : ''
    if (!ALLOWED_TAG_CATEGORIES.has(categoryStr as FrameTagCategory)) continue
    const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 80) : ''
    if (!name) continue
    const key = `${categoryStr}:${name}`
    if (seenTagKeys.has(key)) continue
    seenTagKeys.add(key)
    tags.push({ category: categoryStr as FrameTagCategory, name })
    if (tags.length >= 15) break
  }

  // viralityFactors / weaknesses — массивы строк
  const viralityFactors = Array.isArray(data.viralityFactors)
    ? (data.viralityFactors as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .slice(0, 10)
        .map(s => s.slice(0, 400))
    : []
  const weaknesses = Array.isArray(data.weaknesses)
    ? (data.weaknesses as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .slice(0, 10)
        .map(s => s.slice(0, 400))
    : []

  const audience = typeof data.audience === 'string' && data.audience.trim().length > 0
    ? data.audience.trim().slice(0, 400)
    : null

  // fitScore — обязателен, должен быть числом в [0..1]
  if (typeof data.fitScore !== 'number' || !Number.isFinite(data.fitScore)) {
    throw new AiProviderError('Marketing analyzer: fitScore обязателен (number 0..1)')
  }
  const fitScore = clampScore(data.fitScore, 0)

  const fitRationale = coerceString(data.fitRationale, 800)
  const confidence = clampScore(data.confidence, 0.5)

  return {
    summary,
    structure: { hook, body, cta },
    frameDescriptions,
    viralityFactors,
    weaknesses,
    tags,
    audience,
    fitScore,
    fitRationale,
    confidence,
  }
}

function buildUserContent(
  frames: MarketingFrameInput[],
  context: MarketingFrameContext,
): AnthropicMessageContentBlock[] {
  const blocks: AnthropicMessageContentBlock[] = []
  for (const f of frames) {
    blocks.push({
      type: 'text',
      text: `<frame seq="${f.sequence}" t="${f.timestampSec.toFixed(1)}s" scene="${f.isSceneBoundary}"/>`,
    })
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: f.mimeType, data: f.base64Image },
    })
  }
  blocks.push({
    type: 'text',
    text: `<creative_metadata>
  <title>${context.videoTitle ?? 'без названия'}</title>
  <duration_sec>${context.durationSec}</duration_sec>
  <resolution>${context.width ?? '?'}x${context.height ?? '?'}</resolution>
  <format>${context.format ?? 'unknown'}</format>
  <language>${context.language ?? 'unknown'}</language>
  <platform>${context.platform ?? 'unknown'}</platform>
</creative_metadata>
<app_context>
  <name>${context.appName ?? 'наше приложение'}</name>
  <audience>${context.appAudience ?? 'не указана'}</audience>
  <geo>${context.appGeo ?? 'не указан'}</geo>
</app_context>
<instruction>
Проанализируй кадры выше и верни JSON по схеме из system prompt.
В frameDescriptions включи запись на КАЖДЫЙ кадр (sequence совпадает с маркером).
</instruction>`,
  })
  return blocks
}

/**
 * Marketing-grade анализ кадров через Anthropic vision.
 *
 * В mock-режиме (`ANTHROPIC_MOCK_MODE=true`) возвращает фикстуру
 * `server/__fixtures__/agents/video-frame-analyzer-marketing-happy.json`
 * прогнанную через тот же validator. Caller обязан передать ровно столько
 * кадров, сколько есть в фикстуре (по умолчанию 6) — иначе validator упадёт.
 */
export async function analyzeFramesMarketing(
  frames: MarketingFrameInput[],
  context: MarketingFrameContext,
): Promise<MarketingFrameAnalysis> {
  if (frames.length === 0) {
    throw new AiProviderError('Marketing analyzer: frames empty (нечего анализировать)')
  }

  // Mock-режим: фикстура должна сама пройти validator с длиной = frames.length.
  // Это нужно тесту чтобы менять количество кадров через параметр.
  const { tryMockAnthropicAgent } = await import('../mock/anthropic-mock')
  const mocked = await tryMockAnthropicAgent<MarketingFrameAnalysis>(
    MARKETING_AGENT_NAME,
    raw => validateMarketingFrameAnalysis(raw, frames.length),
  )
  if (mocked.hit) return mocked.value

  requirePaidApisEnabled('Anthropic Claude API')

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ''
  if (!anthropicApiKey) {
    throw createError({
      statusCode: 500,
      message: 'API-ключ Anthropic не настроен. Установите ANTHROPIC_API_KEY',
    })
  }

  const userContent = buildUserContent(frames, context)

  let response: AnthropicVisionResponse
  try {
    response = await $fetch<AnthropicVisionResponse>('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      timeout: 240_000,
      body: {
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: MARKETING_FRAME_ANALYSIS_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' as const },
          },
        ],
        messages: [{ role: 'user', content: userContent }],
      },
    })
  }
  catch (err) {
    const status = (err as { response?: { status?: number }, statusCode?: number })?.response?.status
      ?? (err as { statusCode?: number })?.statusCode
    if (status === 429) {
      throw createError({ statusCode: 429, message: 'Anthropic rate-limit (marketing analyzer)' })
    }
    if (status && status >= 500) {
      throw createError({ statusCode: 502, message: 'Anthropic временно недоступен' })
    }
    throw createError({
      statusCode: 502,
      message: `Anthropic vision error: ${(err as Error)?.message ?? 'unknown'}`,
    })
  }

  const textBlock = response.content.find(c => c.type === 'text')
  if (!textBlock?.text) {
    throw new AiProviderError('Marketing analyzer: пустой ответ Claude', 'malformed_output')
  }

  let parsed: unknown
  try {
    parsed = extractJsonFromText(textBlock.text)
  }
  catch (err) {
    throw new AiProviderError(
      `Marketing analyzer: невалидный JSON в ответе (${(err as Error).message})`,
      'malformed_output',
    )
  }

  return validateMarketingFrameAnalysis(parsed, frames.length)
}
