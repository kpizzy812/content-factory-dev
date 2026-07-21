/**
 * Video Frame Analyzer Agent — Anthropic vision batch для всех кадров видео ОДНИМ запросом.
 *
 * - Один HTTP-вызов к Anthropic /v1/messages с массивом из N image-блоков (base64).
 * - System prompt кэшируется через `cache_control: ephemeral` + header
 *   `anthropic-beta: prompt-caching-2024-07-31`.
 * - Output: JSON-массив из N FrameAnalysisResult в порядке индексов.
 * - Validator подставляет дефолт для невалидных элементов, чтобы один плохой
 *   кадр не валил весь анализ.
 *
 * call-anthropic.ts не поддерживает image-блоки — здесь прямой $fetch.
 */

import { readFile } from 'node:fs/promises'
import type { TranscriptSegment } from '~~/shared/types/reference'
import type { ExtractedFrame } from '../video-content-analyzer'

const ALLOWED_NARRATIVE_ROLES = ['hook', 'setup', 'tension', 'reveal', 'proof', 'cta', 'transition'] as const
type NarrativeRole = (typeof ALLOWED_NARRATIVE_ROLES)[number]

const VISION_MAX_BYTES = 5 * 1024 * 1024
const SUBTITLE_WINDOW_SEC = 1.5

const SYSTEM_PROMPT = `Ты — Visual Storyboard Analyst. Тебе показывают набор кадров из короткого видео для социальных сетей (TikTok/Reels/Shorts).
Твоя задача: точно описать каждый кадр, выделить визуальные паттерны и определить роль кадра в нарративе.

ВАЖНО:
- Описывай только то, что РЕАЛЬНО видно на кадре. Не додумывай.
- Если кадр размыт / переходный / тёмный — отметь это в description, не выдумывай содержание.
- onScreenText — только текст, который виден глазами (субтитры, title cards, UI). Если нет — null. Не подставляй слова из аудио.
- hasAppUI = true только если на кадре реально интерфейс мобильного приложения, а не лендинг/реклама.
- narrativeRole — одно значение из: hook, setup, tension, reveal, proof, cta, transition.
- dominantColors — 3-5 строк (HEX или короткие названия).
- Все ответы на русском.

Ты получишь несколько изображений в одном запросе. Для каждого кадра пользователь укажет index, timestampSec и список соседних субтитров.
Верни СТРОГО JSON-массив объектов в том же порядке, что и входные кадры. Без markdown, без лишнего текста.

Схема одного объекта:
{
  "index": number,
  "timestampSec": number,
  "description": string,
  "onScreenText": string | null,
  "action": string,
  "composition": string,
  "emotionalTone": string,
  "cameraWork": string,
  "dominantColors": string[],
  "lighting": string,
  "hasAppUI": boolean,
  "narrativeRole": "hook" | "setup" | "tension" | "reveal" | "proof" | "cta" | "transition"
}`

export interface FrameAnalysisInput {
  frame: ExtractedFrame
  /** Соседние субтитры в окне ±1.5с */
  nearbySubtitles: TranscriptSegment[]
  totalFrames: number
  videoDurationSec: number | null
  ideaTitle: string | null
  appName: string | null
}

export interface FrameAnalysisResult {
  index: number
  timestampSec: number
  description: string
  onScreenText: string | null
  action: string
  composition: string
  emotionalTone: string
  cameraWork: string
  dominantColors: string[]
  lighting: string
  hasAppUI: boolean
  narrativeRole: NarrativeRole
}

interface AnthropicVisionResponse {
  content: Array<{ type: string; text?: string }>
}

function extractJsonFromText(text: string): unknown {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlock ? codeBlock[1]!.trim() : text.trim()
  return JSON.parse(raw)
}

function defaultResult(index: number, timestampSec: number, note: string): FrameAnalysisResult {
  return {
    index,
    timestampSec,
    description: `[ошибка анализа кадра] ${note}`,
    onScreenText: null,
    action: 'не определено',
    composition: 'не определено',
    emotionalTone: 'нейтральный',
    cameraWork: 'не определено',
    dominantColors: [],
    lighting: 'не определено',
    hasAppUI: false,
    narrativeRole: 'transition',
  }
}

function validateOne(raw: unknown, fallbackIndex: number, fallbackTs: number): FrameAnalysisResult {
  if (!raw || typeof raw !== 'object') return defaultResult(fallbackIndex, fallbackTs, 'не объект')
  const d = raw as Record<string, unknown>
  const role = typeof d.narrativeRole === 'string' && (ALLOWED_NARRATIVE_ROLES as readonly string[]).includes(d.narrativeRole)
    ? (d.narrativeRole as NarrativeRole)
    : 'transition'
  const dominantRaw = Array.isArray(d.dominantColors) ? d.dominantColors : []
  const dominantColors = dominantRaw
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .map(c => c.trim().slice(0, 32))
    .slice(0, 5)

  return {
    index: typeof d.index === 'number' ? d.index : fallbackIndex,
    timestampSec: typeof d.timestampSec === 'number' ? d.timestampSec : fallbackTs,
    description: typeof d.description === 'string' && d.description.trim() ? d.description.trim().slice(0, 1000) : defaultResult(fallbackIndex, fallbackTs, 'нет описания').description,
    onScreenText: typeof d.onScreenText === 'string' && d.onScreenText.trim().length > 0 ? d.onScreenText.trim().slice(0, 400) : null,
    action: typeof d.action === 'string' && d.action.trim() ? d.action.trim().slice(0, 400) : 'не определено',
    composition: typeof d.composition === 'string' && d.composition.trim() ? d.composition.trim().slice(0, 300) : 'не определено',
    emotionalTone: typeof d.emotionalTone === 'string' && d.emotionalTone.trim() ? d.emotionalTone.trim().slice(0, 200) : 'нейтральный',
    cameraWork: typeof d.cameraWork === 'string' && d.cameraWork.trim() ? d.cameraWork.trim().slice(0, 200) : 'не определено',
    dominantColors,
    lighting: typeof d.lighting === 'string' && d.lighting.trim() ? d.lighting.trim().slice(0, 200) : 'не определено',
    hasAppUI: typeof d.hasAppUI === 'boolean' ? d.hasAppUI : false,
    narrativeRole: role,
  }
}

function buildFrameContextLine(input: FrameAnalysisInput, position: number): string {
  const subs = input.nearbySubtitles.length > 0
    ? input.nearbySubtitles.map(s => `[${s.start.toFixed(1)}s] ${s.text}`).join(' | ')
    : 'нет'
  const ts = input.frame.timestampSec.toFixed(1)
  const total = input.totalFrames
  const dur = input.videoDurationSec ? `${input.videoDurationSec.toFixed(1)}с` : 'неизвестна'
  return `Кадр ${position + 1} из ${total} (index=${input.frame.index}, timestampSec=${ts}, видео=${dur}). Соседние субтитры (±${SUBTITLE_WINDOW_SEC}с): ${subs}.`
}

async function callVisionBatch(
  imageBlocks: Array<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>,
  contextText: string,
  instructionText: string,
  retryAfter429: boolean = true,
): Promise<AnthropicVisionResponse> {
  requirePaidApisEnabled('Anthropic Claude API')
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ''

  if (!anthropicApiKey) {
    throw createError({ statusCode: 500, message: 'API-ключ Anthropic не настроен. Установите ANTHROPIC_API_KEY' })
  }

  try {
    return await $fetch<AnthropicVisionResponse>('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      timeout: 180_000,
      body: {
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: contextText },
              ...imageBlocks,
              { type: 'text', text: instructionText },
            ],
          },
        ],
      },
    })
  }
  catch (err) {
    const status = (err as { response?: { status?: number }; statusCode?: number })?.response?.status
      || (err as { statusCode?: number })?.statusCode
    if (status === 429 && retryAfter429) {
      await new Promise(r => setTimeout(r, 5000))
      return callVisionBatch(imageBlocks, contextText, instructionText, false)
    }
    if (status === 429) {
      throw createError({ statusCode: 429, message: 'Anthropic rate-limit (после retry)' })
    }
    if (status && status >= 500) {
      throw createError({ statusCode: 502, message: 'Anthropic временно недоступен' })
    }
    throw createError({ statusCode: 502, message: `Anthropic vision error: ${(err as Error)?.message || 'unknown'}` })
  }
}

/**
 * Один Anthropic-вызов с массивом всех изображений.
 * Output: массив FrameAnalysisResult той же длины что inputs (с дефолтами для невалидных).
 */
export async function analyzeAllFramesBatch(inputs: FrameAnalysisInput[]): Promise<FrameAnalysisResult[]> {
  if (inputs.length === 0) return []

  // Контекст идеи + список кадров
  const ideaTitle = inputs[0]?.ideaTitle || 'не указан'
  const appName = inputs[0]?.appName || 'не указано'
  const total = inputs.length
  const lines: string[] = [
    `Контекст идеи: ${ideaTitle}`,
    `Приложение: ${appName}`,
    `Всего кадров: ${total}`,
    '',
    'Список кадров (по порядку отправки):',
  ]
  inputs.forEach((inp, i) => lines.push(buildFrameContextLine(inp, i)))

  const contextText = lines.join('\n')
  const instructionText = `Проанализируй каждый кадр строго по правилам системного промпта. Верни JSON-массив из ${total} объектов FrameAnalysisResult в том же порядке, что и кадры выше. Без markdown.`

  // Собираем image-блоки
  const imageBlocks: Array<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = []
  const skippedIndices: number[] = []
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i]!
    try {
      const buf = await readFile(inp.frame.filePath)
      if (buf.byteLength > VISION_MAX_BYTES) {
        skippedIndices.push(i)
        continue
      }
      imageBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
      })
    }
    catch {
      skippedIndices.push(i)
    }
  }

  if (imageBlocks.length === 0) {
    return inputs.map((inp, i) => defaultResult(inp.frame.index, inp.frame.timestampSec, 'не удалось прочитать файлы кадров'))
  }

  const response = await callVisionBatch(imageBlocks, contextText, instructionText, true)
  const textBlock = response.content.find(c => c.type === 'text')
  if (!textBlock?.text) {
    return inputs.map(inp => defaultResult(inp.frame.index, inp.frame.timestampSec, 'пустой ответ Claude'))
  }

  let parsedArr: unknown
  try {
    parsedArr = extractJsonFromText(textBlock.text)
  }
  catch {
    return inputs.map(inp => defaultResult(inp.frame.index, inp.frame.timestampSec, 'не валидный JSON'))
  }

  if (!Array.isArray(parsedArr)) {
    return inputs.map(inp => defaultResult(inp.frame.index, inp.frame.timestampSec, 'ответ не массив'))
  }

  // Сопоставляем индексы. Если в ответе меньше элементов, чем кадров на вход — заполняем дефолтами.
  const results: FrameAnalysisResult[] = []
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i]!
    if (skippedIndices.includes(i)) {
      results.push(defaultResult(inp.frame.index, inp.frame.timestampSec, 'кадр пропущен (>5MB или недоступен)'))
      continue
    }
    // Найти элемент с подходящим index либо взять по позиции
    const positionInBatch = i - skippedIndices.filter(s => s < i).length
    const fromArr = parsedArr.find((item) => {
      if (!item || typeof item !== 'object') return false
      const idx = (item as Record<string, unknown>).index
      return typeof idx === 'number' && idx === inp.frame.index
    }) ?? parsedArr[positionInBatch]
    results.push(validateOne(fromArr, inp.frame.index, inp.frame.timestampSec))
  }

  return results
}

/** Утилита для re-analyze одного кадра (на будущее). */
export async function analyzeFrame(input: FrameAnalysisInput): Promise<FrameAnalysisResult> {
  const arr = await analyzeAllFramesBatch([input])
  return arr[0]!
}
