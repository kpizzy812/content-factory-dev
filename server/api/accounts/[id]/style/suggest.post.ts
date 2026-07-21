/**
 * POST /api/accounts/:id/style/suggest
 * AI-генерация рекомендаций по стилю на основе:
 * - метрик успешных постов
 * - референсов
 * - feedback
 * - текущего профиля
 *
 * Не применяет изменения автоматически — возвращает suggestions.
 */
import type {
  AccountStyleProfileData,
  StyleRecommendation,
} from '~~/shared/types/account-style'
import { defaultAccountStyleProfileData } from '~~/shared/types/account-style'

const SUGGEST_SYSTEM_PROMPT = `Ты — креативный директор видеопродакшена. Анализируешь стиль аккаунта в соцсетях и предлагаешь улучшения creative identity на основе метрик, референсов и обратной связи.

Правила:
- Предлагай конкретные, применимые улучшения
- Каждое предложение привязано к конкретной секции стиля
- Не ломай существующую identity — улучшай
- Уровень уверенности: 0-100
- Отвечай на русском
- СТРОГО JSON`

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'social-upload' })
  requirePaidApisEnabled('Anthropic Claude API (style suggestions)')

  const id = Number(getRouterParam(event, 'id'))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID аккаунта' })
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: {
      id: true,
      platform: true,
      displayName: true,
      appId: true,
    },
  })
  if (!account) {
    throw createError({ statusCode: 404, message: 'Аккаунт не найден' })
  }

  // Загружаем текущий профиль
  const profile = await prisma.accountStyleProfile.findUnique({
    where: { socialAccountId: id },
  })
  const currentData = profile
    ? (profile.data as unknown as AccountStyleProfileData)
    : defaultAccountStyleProfileData

  // Собираем контекст: успешные посты, референсы, feedback
  const successfulUploads = await prisma.upload.findMany({
    where: {
      socialAccountId: id,
      status: 'published',
    },
    include: {
      metrics: { orderBy: { collectedAt: 'desc' }, take: 1 },
      references: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  // Собираем feedback для сценариев связанных с этим аккаунтом
  const feedbacks = await prisma.scenarioFeedback.findMany({
    where: {
      uploadId: { in: successfulUploads.map(u => u.id) },
    },
    take: 10,
  })

  // Формируем промпт
  const metricsContext = successfulUploads
    .filter(u => u.metrics.length > 0)
    .map((u) => {
      const m = u.metrics[0]!
      return `- "${u.title}": ${m.views} просмотров, ${m.watchThrough}% досмотр, ${m.likes} лайков, ${m.ctr}% CTR`
    })
    .join('\n')

  const referencesContext = successfulUploads
    .filter(u => u.references.length > 0)
    .map((u) => {
      const ref = u.references[0]!
      return `- Референс: ${ref.reason}${ref.aiAnalysis ? ` | ${ref.aiAnalysis}` : ''}`
    })
    .join('\n')

  const feedbackContext = feedbacks
    .map(f => `- [${f.sentiment}] ${f.feedbackText}`)
    .join('\n')

  const prompt = `Проанализируй стиль аккаунта и предложи улучшения creative identity.

## Аккаунт
- Название: ${account.displayName}
- Платформа: ${account.platform}

## Текущий стиль
${JSON.stringify(currentData, null, 2)}

${metricsContext ? `## Метрики постов\n${metricsContext}` : '## Метрики постов\nНет данных'}

${referencesContext ? `## Успешные референсы\n${referencesContext}` : ''}

${feedbackContext ? `## Обратная связь\n${feedbackContext}` : ''}

## Задача
Предложи конкретные улучшения стиля. Ответь JSON-объектом:
{
  "recommendations": [
    {
      "section": "tone" | "visual" | "subtitles" | "protagonist" | "cta" | "editing" | "preview" | "experimentationDegree" | "consistencyStrictness",
      "field": "конкретное поле внутри секции",
      "currentValue": текущее значение,
      "suggestedValue": предлагаемое значение,
      "reason": "почему это улучшит identity",
      "confidence": число 0-100,
      "source": "analytics" | "reference" | "feedback"
    }
  ],
  "overallAssessment": "общая оценка текущего стиля (2-3 предложения)",
  "identityStrength": число 0-100
}`

  const response = await $fetch<{
    content: Array<{ type: string; text?: string }>
  }>('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    timeout: 60_000,
    body: {
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SUGGEST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    },
  })

  const textBlock = response.content.find(c => c.type === 'text')
  if (!textBlock?.text) {
    throw createError({ statusCode: 502, message: 'AI вернул пустой ответ' })
  }

  const codeBlockMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlockMatch?.[1] ? codeBlockMatch[1].trim() : textBlock.text.trim()
  const parsed = JSON.parse(raw) as {
    recommendations: StyleRecommendation[]
    overallAssessment: string
    identityStrength: number
  }

  // Сохраняем suggestions как pending revision
  if (parsed.recommendations.length > 0 && profile) {
    await prisma.accountStyleRevision.create({
      data: {
        profileId: profile.id,
        version: profile.version,
        changeType: 'ai_suggestion',
        changeSummary: parsed.overallAssessment,
        changedSections: [...new Set(parsed.recommendations.map(r => r.section))],
        previousData: {} as never,
        newData: parsed.recommendations as never,
        accepted: false,
        appliedById: null,
      },
    })
  }

  return {
    data: {
      recommendations: parsed.recommendations,
      overallAssessment: parsed.overallAssessment,
      identityStrength: parsed.identityStrength,
    },
  }
})
