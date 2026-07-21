/**
 * Screen Tagger Agent — анализирует скриншоты приложения через Anthropic vision API.
 *
 * Для каждой картинки определяет:
 *  - aiTags: какой это экран (login_screen, dashboard, checkout, ...)
 *  - aiCaption: 1-2 предложения с описанием
 *  - aiHasUI: реально ли это интерфейс приложения, а не сторонний контекст
 *  - aiPrimaryAction: основной CTA / действие на экране
 *
 * Запускается fire-and-forget из reference-images endpoint при загрузке + ручной rerun.
 *
 * Хранилище секрета: ANTHROPIC_API_KEY. Vision-вызов идёт через прямой messages API
 * (call-anthropic.ts не поддерживает image-блоки, поэтому здесь отдельный код).
 */

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { APP_REFERENCE_AI_TAGS, type AppReferenceAiTag } from '~~/shared/types/app'
import { getStorageDriver } from '~~/server/utils/storage'
import { StorageError } from '~~/server/utils/storage/types'
import { getAppReferencesBase } from '../storage-paths'

const VISION_MAX_BYTES = 5 * 1024 * 1024 // Anthropic recommended ceiling

const SYSTEM_PROMPT = `Ты — UX-аналитик. Тебе показывают скриншот мобильного приложения. Опиши его сжато и поставь теги.

Контролируемый словарь тегов (используй максимум 4 шт. из этого списка, можешь добавить 0-2 свободных):
${APP_REFERENCE_AI_TAGS.map(t => `- ${t}`).join('\n')}

Правила:
- caption — 1-2 предложения на русском, конкретные элементы экрана и контекст
- hasUI = true только если на скрине реально интерфейс приложения. Если это иллюстрация, маркетинг-мокап без UI или просто фотография — false.
- primaryAction — короткая фраза о главном действии экрана: "залогиниться", "оплатить заказ", "просмотреть профиль". Null если действия нет.

Ответь СТРОГО JSON-объектом без markdown:
{
  "tags": ["..."],
  "caption": "...",
  "hasUI": true|false,
  "primaryAction": "..." | null
}`

export interface ScreenAnalysisResult {
  tags: AppReferenceAiTag[]
  caption: string
  hasUI: boolean
  primaryAction: string | null
}

interface AnthropicVisionResponse {
  content: Array<{ type: string; text?: string }>
}

/**
 * Резолвит локальный путь файла из публичного fileUrl. AppReferenceImage хранит
 * URL вида /api/files/app-references/{appId}/{name}, файл лежит на диске в
 * storage/uploads/app-references/{appId}/{name}.
 */
export function resolveAppReferenceLocalPath(appId: number, fileUrl: string): string {
  const name = basename(fileUrl)
  return join(getAppReferencesBase(), String(appId), name)
}

/**
 * Достаёт байты картинки. Приоритет: storage driver через storageKey, затем
 * fallback на legacy локальный путь. Это упрощает запуск Vision на старых
 * записях без storageKey (до миграции БД).
 */
async function loadReferenceBytes(ref: {
  appId: number
  fileUrl: string
  storageKey: string | null
}): Promise<Buffer> {
  if (ref.storageKey) {
    try {
      return await getStorageDriver().downloadToBuffer(ref.storageKey)
    } catch (err: unknown) {
      if (err instanceof StorageError && err.code === "NOT_FOUND") {
        // NOT_FOUND в storage — попробуем legacy FS ниже
      } else {
        throw err
      }
    }
  }
  const localPath = resolveAppReferenceLocalPath(ref.appId, ref.fileUrl)
  return readFile(localPath)
}

export function detectAppReferenceMediaType(mimeType: string | null | undefined, fileUrl: string): string {
  if (mimeType) return mimeType
  const lower = fileUrl.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

function extractJsonFromText(text: string): unknown {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlock ? codeBlock[1]!.trim() : text.trim()
  return JSON.parse(raw)
}

function validate(data: unknown): ScreenAnalysisResult {
  if (!data || typeof data !== 'object') {
    throw new Error('screen-tagger: ответ не объект')
  }
  const d = data as Record<string, unknown>

  const rawTags = Array.isArray(d.tags) ? d.tags : []
  const tags = rawTags
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim().toLowerCase().replace(/\s+/g, '_'))
    .slice(0, 6)

  const caption = typeof d.caption === 'string' && d.caption.trim().length > 0
    ? d.caption.trim().slice(0, 400)
    : ''

  const hasUI = typeof d.hasUI === 'boolean' ? d.hasUI : false

  const primaryAction = typeof d.primaryAction === 'string' && d.primaryAction.trim().length > 0
    ? d.primaryAction.trim().slice(0, 120)
    : null

  if (!caption) {
    throw new Error('screen-tagger: caption пустой')
  }

  return { tags, caption, hasUI, primaryAction }
}

/**
 * Прямой vision-вызов к Anthropic. callAnthropicAgent не поддерживает image-блоки —
 * тут полный путь $fetch с image source.
 */
async function callVision(base64: string, mediaType: string): Promise<ScreenAnalysisResult> {
  requirePaidApisEnabled('Anthropic Claude API')
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ''

  if (!anthropicApiKey) {
    throw createError({
      statusCode: 500,
      message: 'API-ключ Anthropic не настроен. Установите ANTHROPIC_API_KEY в .env',
    })
  }

  const response = await $fetch<AnthropicVisionResponse>('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    timeout: 60_000,
    body: {
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: 'Проанализируй скриншот по правилам системного промпта. Верни строго JSON.',
            },
          ],
        },
      ],
    },
  }).catch((err) => {
    const status = err?.response?.status || err?.statusCode
    if (status === 429) {
      throw createError({ statusCode: 429, message: 'Anthropic rate-limit' })
    }
    if (status && status >= 500) {
      throw createError({ statusCode: 502, message: 'Anthropic временно недоступен' })
    }
    throw createError({
      statusCode: 502,
      message: `Anthropic vision error: ${err?.message || 'unknown'}`,
    })
  })

  const textBlock = response.content.find(c => c.type === 'text')
  if (!textBlock?.text) {
    throw new Error('screen-tagger: пустой ответ Claude')
  }

  return validate(extractJsonFromText(textBlock.text))
}

/**
 * Запускает анализ AppReferenceImage по id. Идемпотентен — переписывает
 * aiTags/aiCaption/aiAnalyzedAt; aiAttempts инкрементится в любом случае.
 */
export async function analyzeAppReferenceImage(refId: string): Promise<ScreenAnalysisResult | null> {
  const ref = await prisma.appReferenceImage.findUnique({ where: { id: refId } })
  if (!ref) {
    throw new Error(`AppReferenceImage ${refId} не найдена`)
  }

  // Сразу инкрементим attempts чтобы рекурсивные ретраи не висели в pending бесконечно
  await prisma.appReferenceImage.update({
    where: { id: refId },
    data: { aiAttempts: { increment: 1 }, aiError: null },
  })

  try {
    const buf = await loadReferenceBytes(ref)

    if (buf.byteLength > VISION_MAX_BYTES) {
      throw new Error(`Файл ${buf.byteLength} байт > лимит vision API ${VISION_MAX_BYTES}`)
    }

    const mediaType = detectAppReferenceMediaType(ref.mimeType, ref.fileUrl)
    const base64 = buf.toString('base64')

    const result = await callVision(base64, mediaType)

    await prisma.appReferenceImage.update({
      where: { id: refId },
      data: {
        aiTags: result.tags,
        aiCaption: result.caption,
        aiHasUI: result.hasUI,
        aiPrimaryAction: result.primaryAction,
        aiAnalyzedAt: new Date(),
        aiError: null,
        bytes: buf.byteLength,
        mimeType: mediaType,
      },
    })

    try {
      await logAgent('screen-tagger', 'info',
        `AppReferenceImage ${refId} проанализирован: ${result.tags.length} тегов, hasUI=${result.hasUI}`,
        { refId, appId: ref.appId, tags: result.tags },
      )
    } catch { /* non-critical */ }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    await prisma.appReferenceImage.update({
      where: { id: refId },
      data: { aiError: message.slice(0, 500) },
    })
    try {
      await logAgent('screen-tagger', 'error',
        `AppReferenceImage ${refId} не проанализирован: ${message}`,
        { refId, appId: ref.appId, error: message },
      )
    } catch { /* non-critical */ }
    return null
  }
}

/**
 * Fire-and-forget обёртка для запуска анализа без блокировки HTTP-handler.
 * Ошибки логируются через logAgent, но не пробрасываются.
 */
export function scheduleScreenAnalysis(refId: string): void {
  analyzeAppReferenceImage(refId).catch((err) => {
    logAgent('screen-tagger', 'error',
      `scheduleScreenAnalysis ${refId} failed: ${err instanceof Error ? err.message : 'unknown'}`,
      { refId },
    ).catch(() => {})
  })
}
