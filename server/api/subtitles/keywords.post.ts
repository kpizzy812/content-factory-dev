/**
 * POST /api/subtitles/keywords
 *
 * Прямой вызов subtitle-keyword-agent для preview/debug. Pipeline дёргает агент сам внутри
 * runAssembly (когда preset.needsKeywordDetection=true) — этот endpoint оставлен для UI,
 * чтобы оператор мог посмотреть какие слова будут выделены до рендера.
 */

import { runSubtitleKeywordAgent } from '~~/server/utils/agents/subtitle-keyword-agent'

interface Body {
  segments?: Array<{ order?: number; text?: string }>
  /** Альтернатива: один кусок текста — agent разобьёт сам как один сегмент. */
  text?: string
  language?: string
  maxKeywordsPerSegment?: number
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'video-generator',
  })

  const body = await readBody<Body>(event)
  if (!body) {
    throw createError({ statusCode: 400, message: 'Тело запроса пустое' })
  }

  const segments: Array<{ order: number; text: string }> = []
  if (Array.isArray(body.segments)) {
    for (let i = 0; i < body.segments.length; i++) {
      const s = body.segments[i]
      if (!s) continue
      const text = typeof s.text === 'string' ? s.text.trim() : ''
      if (!text) continue
      const order = typeof s.order === 'number' ? s.order : i + 1
      segments.push({ order, text })
    }
  } else if (typeof body.text === 'string' && body.text.trim()) {
    segments.push({ order: 1, text: body.text.trim() })
  }

  if (segments.length === 0) {
    throw createError({ statusCode: 400, message: 'Не передан ни один сегмент с текстом' })
  }

  const language = typeof body.language === 'string' && body.language.length > 0
    ? body.language
    : 'ru'
  const maxPerSeg = typeof body.maxKeywordsPerSegment === 'number'
    ? Math.max(1, Math.min(5, body.maxKeywordsPerSegment))
    : 2

  try {
    const result = await runSubtitleKeywordAgent({
      segments,
      language,
      maxKeywordsPerSegment: maxPerSeg,
    })
    return { data: result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка'
    throw createError({
      statusCode: 502,
      message: `AI keyword-detector недоступен: ${msg}`,
    })
  }
})
