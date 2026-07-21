/**
 * POST /api/ai/suggest/field
 *
 * Универсальный AI-suggest для полей конфигурации pipeline-нод.
 * Принимает промт пользователя + тип поля, возвращает сгенерированные данные.
 *
 * Safety: фильтрация секретов/токенов, ограничение длины, валидация структуры.
 */

const VALID_FIELD_TYPES = ['keywords', 'text', 'tags', 'message'] as const
type FieldType = typeof VALID_FIELD_TYPES[number]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    prompt: string
    fieldType: FieldType
    context?: Record<string, unknown>
  }>(event)

  if (!body?.prompt?.trim()) {
    throw createError({ statusCode: 400, message: 'Промт обязателен' })
  }

  const fieldType: FieldType = VALID_FIELD_TYPES.includes(body.fieldType as FieldType)
    ? body.fieldType as FieldType
    : 'keywords'

  const prompt = body.prompt.trim()
  const ctx = body.context ?? {}

  // Sanitize: удалить из контекста любые поля, похожие на секреты
  const sanitizedCtx: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined || v === null || v === '') continue
    // Не передаём AI значения, похожие на секреты
    if (typeof v === 'string' && looksLikeSecret(v)) continue
    sanitizedCtx[k] = v
  }

  const formatInstructions: Record<string, string> = {
    keywords: `Сгенерируй JSON-объект:
{
  "items": ["слово1", "слово2", ...],
  "reasoning": "краткое пояснение логики"
}
items — массив из 5-15 ключевых слов/фраз, релевантных запросу.`,

    tags: `Сгенерируй JSON-объект:
{
  "items": ["тег1", "тег2", ...],
  "reasoning": "краткое пояснение"
}
items — массив из 5-20 тегов/хештегов.`,

    text: `Сгенерируй JSON-объект:
{
  "text": "сгенерированный текст",
  "reasoning": "краткое пояснение"
}
text — строка с результатом. Максимум 500 символов.`,

    message: `Сгенерируй JSON-объект:
{
  "text": "сгенерированное сообщение",
  "reasoning": "краткое пояснение"
}
text — строка с сообщением/уведомлением. Максимум 1000 символов.`,
  }

  // Если контекст содержит taxonomyType — загружаем taxonomy items из БД
  let taxonomyContext = ''
  if (sanitizedCtx.taxonomyType && typeof sanitizedCtx.taxonomyType === 'string') {
    const items = await prisma.taxonomyItem.findMany({
      where: { type: sanitizedCtx.taxonomyType as any, isArchived: false },
      select: { slug: true, name: true, shortDescription: true },
    })
    if (items.length) {
      taxonomyContext = `\nДоступные значения из taxonomy (используй slug):\n${items.map(i => `- ${i.slug} (${i.name}): ${i.shortDescription}`).join('\n')}\n`
    }
    delete sanitizedCtx.taxonomyType
  }

  const contextLines = Object.entries(sanitizedCtx)
    .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n')

  const userPrompt = `Запрос пользователя: "${prompt}"

${contextLines ? `Контекст:\n${contextLines}\n` : ''}${taxonomyContext}
## Формат ответа
${formatInstructions[fieldType] ?? formatInstructions.keywords}

Правила:
- Не генерируй секреты, токены, пароли, API-ключи, приватные URL
- Не генерируй исполняемый код
- Ответь ТОЛЬКО JSON-объектом, без обёрток и пояснений.`

  let capturedUsage: import('~~/server/utils/ai-pricing').AnthropicUsage | null = null
  const result = await callAnthropicAgent({
    systemPrompt: 'Ты — AI-помощник для генерации контента в no-code конвейерах. Генерируй точные, релевантные данные на основе запроса пользователя. Отвечай на русском, если запрос на русском. Отвечай СТРОГО в формате JSON. НИКОГДА не генерируй секреты, токены, API-ключи, пароли.',
    userPrompt,
    tier: 'haiku',
    maxTokens: 1024,
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>
      if (fieldType === 'keywords' || fieldType === 'tags') {
        if (!Array.isArray(d.items)) throw new Error('Ожидался массив items')
        // Фильтруем элементы, похожие на секреты
        const safeItems = (d.items as string[]).filter(
          item => typeof item === 'string' && !looksLikeSecret(item),
        )
        return { items: safeItems, reasoning: d.reasoning } as { items: string[]; reasoning?: string }
      }
      if (typeof d.text !== 'string') throw new Error('Ожидалась строка text')
      // Проверяем текст на секреты
      if (looksLikeSecret(d.text)) {
        throw new Error('Сгенерированный текст содержит потенциально опасные данные')
      }
      // Обрезаем по длине
      const maxLen = fieldType === 'message' ? 1000 : 500
      const text = d.text.length > maxLen ? d.text.slice(0, maxLen) : d.text
      return { text, reasoning: d.reasoning } as { text: string; reasoning?: string }
    },
    onUsage: (u) => { capturedUsage = u },
  })

  // AI Audit Trail
  const session = await getUserSession(event)
  const auditUserId = (session?.user as any)?.id ?? 0
  const auditId = await logAiAudit({
    userId: auditUserId,
    action: 'field_suggest',
    model: process.env.ANTHROPIC_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
    prompt,
    suggestions: result,
    usage: capturedUsage,
  })

  return { data: { ...result, auditId } }
})

/**
 * Эвристика: обнаруживает строки, похожие на секреты/токены.
 */
function looksLikeSecret(value: string): boolean {
  const patterns = [
    /^(sk|pk|api|token|secret|key|bearer|auth)[-_]/i,
    /^eyJ[A-Za-z0-9]/,          // JWT
    /^ghp_[A-Za-z0-9]/,         // GitHub PAT
    /^xox[bpsar]-/,             // Slack tokens
    /^AKIA[A-Z0-9]/,            // AWS access key
    /password|passwd|pwd/i,
  ]
  return patterns.some(p => p.test(value))
}
