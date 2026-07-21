/**
 * POST /api/ai/suggest/scenario
 * Генерация сценария из данных тренда.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    trendTitle?: string
    trendDescription?: string
    appName?: string
    appKeywords?: string[]
  }>(event)

  if (!body?.trendTitle) {
    throw createError({ statusCode: 400, message: 'Поле trendTitle обязательно' })
  }

  const result = await callAnthropicAgent({
    systemPrompt: 'Ты -- сценарист коротких вирусных видео. Пишешь сценарии для TikTok/Reels/Shorts. Отвечай на русском. Отвечай СТРОГО в формате JSON.',
    userPrompt: `Сгенерируй один сценарий для видео на основе тренда.

## Тренд
- Название: ${body.trendTitle}
${body.trendDescription ? `- Описание: ${body.trendDescription}` : ''}
${body.appName ? `- Приложение: ${body.appName}` : ''}
${body.appKeywords?.length ? `- Ключевые слова: ${body.appKeywords.join(', ')}` : ''}

## Задача
Сгенерируй JSON-объект с полями:
- hook: цепляющий хук (первые 3 секунды)
- body: основная часть сценария
- cta: призыв к действию
- visualStyle: описание визуального стиля

Ответь ТОЛЬКО JSON-объектом.`,
    maxTokens: 2048,
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>
      if (
        typeof d.hook !== 'string'
        || typeof d.body !== 'string'
        || typeof d.cta !== 'string'
        || typeof d.visualStyle !== 'string'
      ) {
        throw new Error('Некорректный формат ответа: ожидались поля hook, body, cta, visualStyle')
      }
      return d as { hook: string; body: string; cta: string; visualStyle: string }
    },
  })

  return { data: result }
})
