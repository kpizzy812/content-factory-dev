/**
 * POST /api/ai/suggest/entity
 *
 * Entity-level AI autofill: генерирует предложения для безопасных полей сущностей
 * Character и Scene (НЕ pipeline-нод). Используется в CharacterCreateModal /
 * /characters/[id] / SceneCreateModal / SceneComposer.
 *
 * Отличия от /api/ai/suggest/block:
 *  - не связан с pipelineId/nodeCanvasId — это работа с моделями БД, не с graph;
 *  - moduleSlug='script-generator' (не 'pipeline') — зеркалит модуль страниц
 *    /characters и /scenes;
 *  - тип Anthropic — 'haiku' (короткие поля, не нужны рассуждения Sonnet);
 *  - нормализация tags: AI может вернуть строку через запятую — split в массив.
 *
 * Safety: AI заполняет только поля с aiSafe=true из nodeFieldSchemas[character_entity|scene_entity].
 */

import {
  getAiSafeFields,
  getAiBlockedFields,
  validateAiOutput,
} from '~~/app/utils/pipeline-node-schema'
import {
  resolveEntityNodeType,
  normalizeTagsField,
  looksLikeSecret,
} from '~~/server/utils/ai-entity-suggest'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    entityType?: string
    prompt?: string
    currentValues?: Record<string, unknown>
    entityId?: string | number
    appId?: number
  }>(event)

  if (!body?.prompt?.trim()) {
    throw createError({ statusCode: 400, message: 'Промт обязателен' })
  }

  const nodeType = resolveEntityNodeType(body.entityType ?? '')
  if (!nodeType) {
    throw createError({
      statusCode: 400,
      message: `Неизвестный entityType: ${body.entityType}. Допустимые: character, scene.`,
    })
  }

  // Permission guard — moduleSlug='script-generator' (как у /characters и /scenes).
  // appId передаём только если он реально указан — иначе guard проверит лишь модуль.
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'script-generator',
    ...(typeof body.appId === 'number' && body.appId > 0 ? { appId: body.appId } : {}),
  })

  const prompt = body.prompt.trim()
  const safeFields = getAiSafeFields(nodeType)
  const blockedFields = getAiBlockedFields(nodeType)

  // Контекст приложения — улучшает релевантность предложений, если appId передан.
  let appContext = ''
  if (typeof body.appId === 'number' && body.appId > 0) {
    const app = await prisma.app.findUnique({
      where: { id: body.appId },
      select: {
        name: true,
        description: true,
        subtitle: true,
        targetAudience: true,
        brandTone: true,
      },
    })
    if (app) {
      const parts: string[] = [`Название: ${app.name}`]
      if (app.subtitle) parts.push(`Короткое описание: ${app.subtitle}`)
      else if (app.description) parts.push(`Описание: ${app.description.slice(0, 300)}`)
      if (app.targetAudience) parts.push(`Целевая аудитория: ${app.targetAudience}`)
      if (app.brandTone) parts.push(`Тон бренда: ${app.brandTone}`)
      appContext = parts.join('\n')
    }
  }

  // Описание полей для AI
  const fieldsDescription = Object.entries(safeFields)
    .map(([key, field]) => {
      let desc = `- "${key}" (${field.label}): ${field.hint}`
      if (field.allowedValues?.length) {
        desc += ` Допустимые значения: [${field.allowedValues.join(', ')}]`
      }
      if (field.type === 'tags') desc += ' [массив строк]'
      if (field.type === 'number') desc += ' [число]'
      if (field.type === 'toggle') desc += ' [true/false]'
      if (field.maxLength) desc += ` [макс. ${field.maxLength} символов]`
      return desc
    })
    .join('\n')

  const currentValuesLines = body.currentValues
    ? Object.entries(body.currentValues)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v).slice(0, 200)}`)
        .join('\n')
    : ''

  const entityLabel = nodeType === 'character_entity' ? 'персонажа' : 'сцены'

  const userPrompt = `Задача пользователя: "${prompt}"

## Тип сущности: ${entityLabel}

${appContext ? `## Контекст приложения\n${appContext}\n` : ''}
## Доступные поля (ТОЛЬКО эти поля, никаких других)
${fieldsDescription}

${currentValuesLines ? `## Текущие значения (дополняй, не перетирай если уже заполнено осмысленно)\n${currentValuesLines}\n` : ''}
## Формат ответа
Сгенерируй JSON-объект:
{
  "suggestions": {
    "fieldName": value,
    ...
  },
  "reasoning": "Краткое пояснение логики заполнения (1-2 предложения)"
}

Правила:
1. Заполняй ТОЛЬКО перечисленные выше поля.
2. Для полей с допустимыми значениями — используй ТОЛЬКО значения из списка.
3. Для tags — возвращай массив строк, НЕ строку через запятую.
4. Не превышай максимальную длину.
5. НЕ генерируй секреты, токены, пароли, URL с авторизацией.
6. Если не можешь безопасно заполнить поле — пропусти его.

Ответь ТОЛЬКО JSON-объектом.`

  let capturedUsage: import('~~/server/utils/ai-pricing').AnthropicUsage | null = null
  const result = await callAnthropicAgent({
    agentName: nodeType === 'character_entity' ? 'entity-suggest-character' : 'entity-suggest-scene',
    tier: 'haiku',
    systemPrompt: `Ты — AI-помощник для автозаполнения полей сущностей (персонажи, сцены) в библиотеке креативного контента.
Твоя задача — предложить осмысленные значения на основе описания пользователя.
Отвечай на русском, если запрос на русском. Отвечай СТРОГО в формате JSON.
НИКОГДА не генерируй: секреты, токены, пароли, приватные URL, исполняемый код.`,
    userPrompt,
    maxTokens: 1024,
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>
      if (!d.suggestions || typeof d.suggestions !== 'object') {
        throw new Error('Ожидался объект suggestions')
      }
      return d as { suggestions: Record<string, unknown>; reasoning?: string }
    },
    onUsage: (u) => { capturedUsage = u },
  })

  // Нормализация tags (AI часто возвращает строку через запятую несмотря на инструкцию)
  const normalized = normalizeTagsField(nodeType, result.suggestions)

  // Пост-валидация через схему (maxLength, allowedValues, фильтр незнакомых полей)
  const { safe: validated, blocked: rejectedFromSchema } = validateAiOutput(nodeType, normalized)

  // looksLikeSecret защита для строковых значений
  const rejected: Array<{ field: string; reason: string }> = [...rejectedFromSchema]
  const finalSuggestions: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(validated)) {
    if (typeof value === 'string' && looksLikeSecret(value)) {
      rejected.push({ field: key, reason: 'Обнаружен потенциальный секрет/токен' })
      continue
    }
    finalSuggestions[key] = value
  }

  const session = await getUserSession(event)
  const auditUserId = (session?.user as { id?: number } | undefined)?.id ?? 0
  const auditId = await logAiAudit({
    userId: auditUserId,
    action: 'block_suggest',
    nodeType,
    // pipelineId/nodeCanvasId не задаём — это entity-level, не pipeline.
    model: process.env.ANTHROPIC_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
    prompt,
    suggestions: finalSuggestions,
    blockedFields,
    rejectedFields: rejected.length ? rejected : undefined,
    usage: capturedUsage,
  })

  return {
    data: {
      auditId,
      suggestions: finalSuggestions,
      blocked: blockedFields,
      rejected,
      reasoning: result.reasoning || '',
    },
  }
})

