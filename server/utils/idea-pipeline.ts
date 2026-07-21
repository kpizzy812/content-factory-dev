/**
 * Pipeline для обработки идей: извлечение метаданных + AI-анализ.
 *
 * Этап 0: fetchVideoMetadata() — oEmbed + OG-теги (реальные данные)
 * Этап 1: базовый AI-анализ на основе реальных метаданных (плоские поля)
 * Этап 2: структурированный AI-анализ (IdeaAnalysis — формат CreativeBrief)
 *
 * AI получает реальный заголовок, описание, автора, хештеги — не выдумывает.
 */

import { runIdeaAnalyzer, IDEA_ANALYZER_PROMPT_VERSION } from './agents/idea-analyzer-agent'
import { fetchVideoMetadata, type VideoMetadata } from './video-metadata'

interface IdeaBasicResult {
  title: string
  hook: string
  body: string
  cta: string
  visualStyle: string
  whyViral: string
}

const BASIC_SYSTEM_PROMPT = `Ты -- эксперт по вирусному видеоконтенту. Анализируешь видео на основе предоставленных метаданных и выделяешь ключевые элементы.

ВАЖНО:
- Анализируй ТОЛЬКО на основе предоставленных данных (заголовок, описание, автор, хештеги).
- НЕ выдумывай факты, которых нет в данных.
- Если данных недостаточно для вывода, напиши "Недостаточно данных для анализа".
- Отвечай ТОЛЬКО на указанном языке.
- Отвечай СТРОГО в формате JSON.`

function buildBasicPrompt(metadata: VideoMetadata, sourceUrl: string, language: string): string {
  const parts: string[] = []
  parts.push(`URL: ${sourceUrl}`)
  if (metadata.platform) parts.push(`Платформа: ${metadata.platform}`)
  if (metadata.title) parts.push(`Заголовок видео: ${metadata.title}`)
  if (metadata.description) parts.push(`Описание: ${metadata.description}`)
  if (metadata.authorName) parts.push(`Автор: ${metadata.authorName}`)
  if (metadata.hashtags.length > 0) parts.push(`Хештеги: ${metadata.hashtags.map(t => '#' + t).join(' ')}`)
  if (metadata.duration) parts.push(`Длительность: ${metadata.duration} сек`)
  parts.push(`Источник метаданных: ${metadata.metadataSource}`)

  return `На основе метаданных видео проведи анализ.

## Метаданные видео
${parts.join('\n')}

## Задача
Определи на основе РЕАЛЬНЫХ данных выше:
- title: заголовок (используй реальный заголовок видео, при необходимости сократи до 80 символов)
- hook: хук (на основе заголовка и описания — что цепляет зрителя)
- body: основная часть (на основе описания — как подаётся контент)
- cta: призыв к действию (если виден в описании/хештегах, иначе предположи минимально)
- visualStyle: визуальный стиль (если доступны данные, иначе "Определяется по видео")
- whyViral: почему видео может залетать (на основе хештегов, описания, платформы)

Язык ответа: ${language}. Ответь ТОЛЬКО JSON-объектом с полями: title, hook, body, cta, visualStyle, whyViral. Без обёрток и пояснений.`
}

function extractJson(text: string): unknown {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlockMatch ? codeBlockMatch[1]!.trim() : text.trim()
  return JSON.parse(raw)
}

function validateBasicAnalysis(data: unknown): IdeaBasicResult {
  if (!data || typeof data !== 'object') {
    throw new Error('Ответ AI не является объектом')
  }

  const fields = ['title', 'hook', 'body', 'cta', 'visualStyle', 'whyViral'] as const
  const obj = data as Record<string, unknown>

  for (const field of fields) {
    if (typeof obj[field] !== 'string') {
      throw new Error(`Поле '${field}' отсутствует или не является строкой`)
    }
  }

  return data as IdeaBasicResult
}

/**
 * Полная обработка идеи: метаданные → базовый анализ → структурированный анализ.
 */
export async function processIdea(ideaId: number): Promise<void> {
  try {
    const idea = await prisma.idea.findUnique({ where: { id: ideaId } })
    if (!idea) return

    await prisma.idea.update({
      where: { id: ideaId },
      data: { status: 'processing', analysisStatus: 'pending' },
    })

    if (!idea.sourceUrl) {
      await prisma.idea.update({
        where: { id: ideaId },
        data: { status: 'failed', errorMessage: 'URL источника не указан' },
      })
      return
    }

    // Этап 0: извлечение реальных метаданных
    const metadata = await fetchVideoMetadata(idea.sourceUrl)

    if (metadata.metadataSource === 'none') {
      console.warn(`[idea-pipeline] Не удалось извлечь метаданные для ${idea.sourceUrl}`)
      // Не блокируем — AI может дать хоть какой-то анализ, но это будет отмечено
    }

    // Сохраняем платформу из метаданных
    const platform = metadata.platform

    // Сохраняем извлечённые метаданные как transcription (для прозрачности)
    const metadataLog = [
      metadata.title ? `Заголовок: ${metadata.title}` : null,
      metadata.description ? `Описание: ${metadata.description}` : null,
      metadata.authorName ? `Автор: ${metadata.authorName}` : null,
      metadata.hashtags.length > 0 ? `Хештеги: ${metadata.hashtags.map(t => '#' + t).join(' ')}` : null,
      metadata.duration ? `Длительность: ${metadata.duration} сек` : null,
      `Источник: ${metadata.metadataSource}`,
    ].filter(Boolean).join('\n')

    await prisma.idea.update({
      where: { id: ideaId },
      data: {
        platform,
        transcription: metadataLog || idea.transcription,
        // Если метаданные дали title и у идеи его нет — используем
        ...(metadata.title && !idea.title ? { title: metadata.title.slice(0, 200) } : {}),
      },
    })

    requirePaidApisEnabled('Anthropic Claude API')

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ''
    if (!anthropicApiKey) {
      await prisma.idea.update({
        where: { id: ideaId },
        data: { status: 'failed', errorMessage: 'ANTHROPIC_API_KEY не настроен' },
      })
      return
    }

    const language = idea.language || 'русский'

    // Этап 1: базовый AI-анализ на основе реальных метаданных
    const response = await $fetch<{
      content: Array<{ type: string; text?: string }>
    }>('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 60_000,
      body: {
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: BASIC_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: buildBasicPrompt(metadata, idea.sourceUrl, language) },
        ],
      },
    })

    const textBlock = response.content.find((c) => c.type === 'text')
    if (!textBlock?.text) {
      throw new Error('AI-сервис вернул пустой ответ')
    }

    const parsed = extractJson(textBlock.text)
    const result = validateBasicAnalysis(parsed)

    await prisma.idea.update({
      where: { id: ideaId },
      data: {
        title: result.title,
        hook: result.hook,
        body: result.body,
        cta: result.cta,
        visualStyle: result.visualStyle,
        whyViral: result.whyViral,
        platform,
        status: 'ready',
        analysisStatus: 'running',
      },
    })

    // Этап 2: структурированный анализ (IdeaAnalysis — формат CreativeBrief)
    try {
      const structured = await runIdeaAnalyzer({
        sourceUrl: idea.sourceUrl,
        platform,
        title: metadata.title || result.title,
        description: metadata.description,
        authorName: metadata.authorName,
        hashtags: metadata.hashtags,
        transcription: idea.transcription,
        language,
      })

      await prisma.ideaAnalysis.upsert({
        where: { ideaId },
        create: {
          ideaId,
          hookAnalysis: structured.hookAnalysis as any,
          sceneStructure: structured.sceneStructure as any,
          visualStyle: structured.visualStyle as any,
          viralityReasons: structured.viralityReasons as any,
          summary: structured.summary,
          modelVersion: anthropicModel,
          promptVersion: IDEA_ANALYZER_PROMPT_VERSION,
          confidence: structured.confidence ?? null,
        },
        update: {
          hookAnalysis: structured.hookAnalysis as any,
          sceneStructure: structured.sceneStructure as any,
          visualStyle: structured.visualStyle as any,
          viralityReasons: structured.viralityReasons as any,
          summary: structured.summary,
          modelVersion: anthropicModel,
          promptVersion: IDEA_ANALYZER_PROMPT_VERSION,
          confidence: structured.confidence ?? null,
        },
      })

      await prisma.idea.update({
        where: { id: ideaId },
        data: { analysisStatus: 'completed' },
      })
    } catch (analysisErr: unknown) {
      const msg = analysisErr instanceof Error ? analysisErr.message : 'Неизвестная ошибка'
      console.warn(`[idea-pipeline] Структурированный анализ для идеи ${ideaId} не удался: ${msg}`)
      await prisma.idea.update({
        where: { id: ideaId },
        data: { analysisStatus: 'failed' },
      }).catch(() => {})
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    await prisma.idea.update({
      where: { id: ideaId },
      data: { status: 'failed', analysisStatus: 'failed', errorMessage: message },
    }).catch(() => {})
  }
}

/**
 * Повторный структурированный анализ для существующей идеи.
 */
export async function reanalyzeIdea(ideaId: number): Promise<void> {
  const idea = await prisma.idea.findUnique({ where: { id: ideaId } })
  if (!idea || !idea.sourceUrl) {
    throw new Error('Идея не найдена или URL не указан')
  }

  await prisma.idea.update({
    where: { id: ideaId },
    data: { analysisStatus: 'running' },
  })

  try {
    // Извлекаем свежие метаданные
    const metadata = await fetchVideoMetadata(idea.sourceUrl)
    const language = idea.language || 'русский'

    const structured = await runIdeaAnalyzer({
      sourceUrl: idea.sourceUrl,
      platform: metadata.platform,
      title: metadata.title || idea.title,
      description: metadata.description,
      authorName: metadata.authorName,
      hashtags: metadata.hashtags,
      transcription: idea.transcription,
      language,
    })

    const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

    await prisma.ideaAnalysis.upsert({
      where: { ideaId },
      create: {
        ideaId,
        hookAnalysis: structured.hookAnalysis as any,
        sceneStructure: structured.sceneStructure as any,
        visualStyle: structured.visualStyle as any,
        viralityReasons: structured.viralityReasons as any,
        summary: structured.summary,
        modelVersion: anthropicModel,
        promptVersion: IDEA_ANALYZER_PROMPT_VERSION,
        confidence: structured.confidence ?? null,
      },
      update: {
        hookAnalysis: structured.hookAnalysis as any,
        sceneStructure: structured.sceneStructure as any,
        visualStyle: structured.visualStyle as any,
        viralityReasons: structured.viralityReasons as any,
        summary: structured.summary,
        modelVersion: anthropicModel,
        promptVersion: IDEA_ANALYZER_PROMPT_VERSION,
        confidence: structured.confidence ?? null,
      },
    })

    // Обновляем метаданные идеи если получили свежие
    const updateData: Record<string, unknown> = { analysisStatus: 'completed' }
    if (metadata.title && !idea.title) updateData.title = metadata.title.slice(0, 200)
    if (metadata.platform && !idea.platform) updateData.platform = metadata.platform

    await prisma.idea.update({
      where: { id: ideaId },
      data: updateData,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    await prisma.idea.update({
      where: { id: ideaId },
      data: { analysisStatus: 'failed', errorMessage: message },
    }).catch(() => {})
    throw err
  }
}
