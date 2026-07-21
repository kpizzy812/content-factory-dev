/**
 * POST /api/ai/suggest/taxonomy
 *
 * AI генерирует новый taxonomy item на основе описания пользователя.
 * Возвращает draft, который пользователь может сохранить через обычный CRUD.
 */

const VALID_TYPES = ['strategy', 'hook_style', 'prompt_pattern'] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    type: string
    prompt: string
  }>(event)

  if (!body?.prompt?.trim()) {
    throw createError({ statusCode: 400, message: 'Описание обязательно' })
  }
  if (!body?.type || !VALID_TYPES.includes(body.type as any)) {
    throw createError({ statusCode: 400, message: `Неизвестный тип: ${body.type}` })
  }

  const typeLabels: Record<string, string> = {
    strategy: 'стратегия поиска трендов',
    hook_style: 'стиль хука для видео',
    prompt_pattern: 'шаблон промта',
  }

  // Загружаем существующие для контекста
  const existing = await prisma.taxonomyItem.findMany({
    where: { type: body.type as any, isArchived: false },
    select: { slug: true, name: true, shortDescription: true },
  })

  const existingList = existing.length
    ? `\nУже существующие элементы (НЕ дублируй их):\n${existing.map(e => `- ${e.slug}: ${e.name} — ${e.shortDescription}`).join('\n')}\n`
    : ''

  const result = await callAnthropicAgent({
    systemPrompt: `Ты — AI-помощник для создания элементов taxonomy в no-code конвейерах.
Отвечай на русском. Отвечай СТРОГО в формате JSON.
Не генерируй секреты, токены, пароли.`,
    tier: 'haiku',
    userPrompt: `Пользователь хочет создать новый элемент типа "${typeLabels[body.type] || body.type}".

Описание от пользователя: "${body.prompt.trim()}"
${existingList}
Сгенерируй JSON:
{
  "name": "Краткое название",
  "shortDescription": "Одно предложение — суть",
  "fullExplanation": "Подробное объяснение: когда использовать, плюсы, минусы",
  "category": "Категория",
  "tags": ["тег1", "тег2"],
  "examples": ["Пример использования 1", "Пример 2"],
  "useCases": ["Случай использования 1", "Случай 2"]
}

Правила:
- name — 2-4 слова, ёмко
- shortDescription — не более 1 предложения
- fullExplanation — 2-3 предложения
- tags — 3-5 тегов
- examples — 2-3 примера
- useCases — 2-3 случая использования
- НЕ дублируй существующие элементы
- Ответь ТОЛЬКО JSON-объектом`,
    maxTokens: 1024,
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>
      if (!d.name || typeof d.name !== 'string') throw new Error('Ожидалось поле name')
      if (!d.shortDescription || typeof d.shortDescription !== 'string') throw new Error('Ожидалось поле shortDescription')
      return d as {
        name: string
        shortDescription: string
        fullExplanation?: string
        category?: string
        tags?: string[]
        examples?: string[]
        useCases?: string[]
      }
    },
  })

  return {
    data: {
      draft: {
        type: body.type,
        ...result,
      },
    },
  }
})
