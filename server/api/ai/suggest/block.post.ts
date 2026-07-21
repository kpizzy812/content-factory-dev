/**
 * POST /api/ai/suggest/block
 *
 * Block-level AI autofill: генерирует предложения для ВСЕХ безопасных полей ноды
 * на основе описания задачи пользователем.
 *
 * Safety: AI заполняет только поля с aiSafe=true из pipeline-node-schema.
 * Небезопасные поля (секреты, ссылки на ресурсы, код) явно блокируются.
 */

import { nodeFieldSchemas, getAiSafeFields, getAiBlockedFields } from '~~/app/utils/pipeline-node-schema'

const VALID_NODE_TYPES = Object.keys(nodeFieldSchemas)

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    nodeType: string
    prompt: string
    currentConfig?: Record<string, unknown>
    pipelineId?: number
    nodeCanvasId?: string
  }>(event)

  if (!body?.prompt?.trim()) {
    throw createError({ statusCode: 400, message: 'Промт обязателен' })
  }

  if (!body.nodeType || !VALID_NODE_TYPES.includes(body.nodeType)) {
    throw createError({ statusCode: 400, message: `Неизвестный тип ноды: ${body.nodeType}` })
  }

  const prompt = body.prompt.trim()
  const nodeType = body.nodeType
  const safeFields = getAiSafeFields(nodeType)
  const blockedFields = getAiBlockedFields(nodeType)

  if (Object.keys(safeFields).length === 0) {
    return {
      data: {
        suggestions: {},
        blocked: blockedFields,
        reasoning: 'У этого типа блока нет полей, которые AI может безопасно заполнить.',
      },
    }
  }

  // Загружаем taxonomy items для полей с taxonomyType
  const taxonomyCache: Record<string, string[]> = {}
  for (const [, field] of Object.entries(safeFields)) {
    if (field.taxonomyType && !taxonomyCache[field.taxonomyType]) {
      const items = await prisma.taxonomyItem.findMany({
        where: { type: field.taxonomyType as any, isArchived: false },
        select: { slug: true, name: true, shortDescription: true },
      })
      taxonomyCache[field.taxonomyType] = items.map(i => i.slug)
      // Сохраняем расширенное описание для промта
      ;(taxonomyCache as any)[`${field.taxonomyType}_desc`] = items
        .map(i => `${i.slug} (${i.name}): ${i.shortDescription}`)
        .join('; ')
    }
  }

  // Загружаем приложения для полей с appSelectField
  let appsList: Array<{ id: number; name: string }> = []
  const hasAppField = Object.values(safeFields).some(f => (f as any).appSelectField)
  if (hasAppField) {
    appsList = await prisma.app.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  }

  // Формируем описание безопасных полей для AI
  const fieldsDescription = Object.entries(safeFields)
    .map(([key, field]) => {
      let desc = `- "${key}" (${field.label}): ${field.hint}`
      if ((field as any).appSelectField && appsList.length > 0) {
        desc += ` Каталог приложений: ${appsList.map(a => `id=${a.id} ("${a.name}")`).join(', ')}.`
        desc += ` Если в промте упомянуто имя приложения из каталога — верни его id (число). Если не упомянуто или не нашлось — пропусти поле.`
        desc += ' [тип: целое число]'
      } else if (field.taxonomyType && taxonomyCache[field.taxonomyType]) {
        const descKey = `${field.taxonomyType}_desc`
        desc += ` Допустимые значения (taxonomy): [${taxonomyCache[field.taxonomyType]!.join(', ')}]. Описание: ${(taxonomyCache as any)[descKey]}`
      } else if (field.allowedValues?.length) {
        desc += ` Допустимые значения: [${field.allowedValues.join(', ')}]`
      }
      if (field.type === 'taxonomy') desc += ' [выбор из taxonomy — используй slug]'
      if (field.type === 'tags') desc += ' [массив строк]'
      if (field.type === 'number') desc += ' [число]'
      if (field.type === 'toggle') desc += ' [true/false]'
      if (field.maxLength) desc += ` [макс. ${field.maxLength} символов]`
      return desc
    })
    .join('\n')

  const currentConfigLines = body.currentConfig
    ? Object.entries(body.currentConfig)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n')
    : ''

  const userPrompt = `Задача пользователя: "${prompt}"

## Тип блока: ${nodeType}

## Доступные поля (ТОЛЬКО эти поля, никаких других):
${fieldsDescription}

${currentConfigLines ? `## Текущая конфигурация:\n${currentConfigLines}\n` : ''}
## Формат ответа
Сгенерируй JSON-объект:
{
  "suggestions": {
    "fieldName": value,
    ...
  },
  "reasoning": "Краткое пояснение логики заполнения"
}

Правила:
1. Заполняй ТОЛЬКО перечисленные выше поля
2. Для полей с допустимыми значениями — используй ТОЛЬКО значения из списка
3. Для массивов строк — возвращай массив
4. Для чисел — возвращай числа
5. Для toggle — возвращай true/false
6. Не превышай максимальную длину
7. НЕ генерируй секреты, токены, пароли, URL с авторизацией
8. Если не можешь безопасно заполнить поле — пропусти его

Ответь ТОЛЬКО JSON-объектом.`

  let capturedUsage: import('~~/server/utils/ai-pricing').AnthropicUsage | null = null
  const result = await callAnthropicAgent({
    systemPrompt: `Ты — AI-помощник для автозаполнения настроек блоков в no-code конвейерах.
Твоя задача — предложить осмысленные значения для полей блока на основе описания задачи.
Отвечай на русском, если запрос на русском. Отвечай СТРОГО в формате JSON.
НИКОГДА не генерируй: секреты, токены, пароли, приватные URL, исполняемый код.`,
    userPrompt,
    maxTokens: 2048,
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>
      if (!d.suggestions || typeof d.suggestions !== 'object') {
        throw new Error('Ожидался объект suggestions')
      }
      return d as { suggestions: Record<string, unknown>; reasoning?: string }
    },
    onUsage: (u) => { capturedUsage = u },
  })

  // Нормализация: Claude может вернуть dot-notation ("app.appId": 4) ИЛИ вложенный
  // объект ({app: {appId: 4}}). Конвертируем оба в плоский dot-формат для единой
  // валидации через safeFields схему.
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(result.suggestions)) {
    if (key.includes('.')) {
      flat[key] = value
      continue
    }
    if (nodeType === 'scenario' && value && typeof value === 'object' && !Array.isArray(value)) {
      // Раскручиваем nested для scenario node (storytelling/subtitles/app/voiceover)
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        flat[`${key}.${subKey}`] = subVal
      }
    } else {
      flat[key] = value
    }
  }

  // Пост-валидация: фильтруем через схему
  const validated: Record<string, unknown> = {}
  const rejected: Array<{ field: string; reason: string }> = []

  for (const [key, value] of Object.entries(flat)) {
    // Dot-notation для scenario — unflatten в validated после полной проверки
    if (key.includes('.') && nodeType === 'scenario') {
      const field = safeFields[key]
      if (!field) {
        rejected.push({ field: key, reason: 'Поле не в списке безопасных' })
        continue
      }

      // Валидация appSelectField даже для dot-notation (раньше пропускалось)
      let validatedValue: unknown = value
      if ((field as any).appSelectField) {
        const numVal = Number(value)
        if (!Number.isInteger(numVal) || !appsList.some(a => a.id === numVal)) {
          rejected.push({ field: key, reason: `Приложение с id=${value} не найдено в каталоге` })
          continue
        }
        validatedValue = numVal
      } else if (field.allowedValues?.length && !field.allowedValues.includes(String(value))) {
        rejected.push({ field: key, reason: `Недопустимое значение: ${value}` })
        continue
      }

      // Unflatten: 'app.appId' → validated.app.appId
      const [section, fieldName] = key.split('.', 2)
      if (section && fieldName) {
        if (!validated[section] || typeof validated[section] !== 'object') {
          validated[section] = {}
        }
        ;(validated[section] as Record<string, unknown>)[fieldName] = validatedValue
      }
      continue
    }

    const field = safeFields[key]
    if (!field) {
      rejected.push({ field: key, reason: 'Поле не в списке безопасных' })
      continue
    }

    // Проверка appId — должен быть из списка реальных приложений
    if ((field as any).appSelectField) {
      const numVal = Number(value)
      if (!Number.isInteger(numVal) || !appsList.some(a => a.id === numVal)) {
        rejected.push({ field: key, reason: `Приложение с id=${value} не найдено` })
      } else {
        validated[key] = numVal
      }
      continue
    }

    // Проверка taxonomy значений (из БД)
    if (field.taxonomyType && taxonomyCache[field.taxonomyType]) {
      const allowed = taxonomyCache[field.taxonomyType]!
      if (Array.isArray(value)) {
        const filtered = (value as string[]).filter(v => allowed.includes(String(v)))
        if (filtered.length > 0) validated[key] = filtered
        else rejected.push({ field: key, reason: 'Ни одно значение не входит в taxonomy' })
      } else if (allowed.includes(String(value))) {
        validated[key] = value
      } else {
        rejected.push({ field: key, reason: `Значение "${value}" не найдено в taxonomy` })
      }
      continue
    }

    // Проверка допустимых значений
    if (field.allowedValues?.length) {
      if (Array.isArray(value)) {
        const filtered = (value as string[]).filter(v => field.allowedValues!.includes(String(v)))
        if (filtered.length > 0) validated[key] = filtered
        else rejected.push({ field: key, reason: 'Ни одно значение не допустимо' })
      } else if (field.allowedValues.includes(String(value))) {
        validated[key] = value
      } else {
        rejected.push({ field: key, reason: `Недопустимое значение: ${value}` })
      }
      continue
    }

    // Обрезка по длине
    if (field.maxLength && typeof value === 'string' && value.length > field.maxLength) {
      validated[key] = value.slice(0, field.maxLength)
      continue
    }

    // Обрезка тегов
    if (field.maxLength && Array.isArray(value)) {
      validated[key] = (value as string[]).map(v =>
        typeof v === 'string' && v.length > field.maxLength! ? v.slice(0, field.maxLength!) : v,
      )
      continue
    }

    // Паттерн-детекция: блокируем если похоже на секрет/токен
    if (typeof value === 'string' && looksLikeSecret(value)) {
      rejected.push({ field: key, reason: 'Обнаружен потенциальный секрет/токен' })
      continue
    }

    validated[key] = value
  }

  // AI Audit Trail
  const session = await getUserSession(event)
  const auditUserId = (session?.user as any)?.id ?? 0
  const auditId = await logAiAudit({
    userId: auditUserId,
    action: 'block_suggest',
    nodeType,
    pipelineId: body.pipelineId ?? undefined,
    nodeCanvasId: body.nodeCanvasId ?? undefined,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    prompt,
    suggestions: validated,
    blockedFields,
    rejectedFields: rejected.length ? rejected : undefined,
    usage: capturedUsage,
  })

  return {
    data: {
      auditId,
      suggestions: validated,
      blocked: blockedFields,
      rejected,
      reasoning: result.reasoning || '',
    },
  }
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
