/**
 * POST /api/admin/telegram/templates/generate
 *
 * AI-генерация шаблона Telegram-уведомления по описанию пользователя.
 * AI ограничен canonical variable registry — не может выдумывать переменные.
 * Валидирует output по registry и syntax rules.
 */

import {
  registryForAiPrompt,
  validateTemplateBody,
  getAllVariableKeys,
  type VariableScope,
} from "~~/server/utils/telegram/variable-registry"

const VALID_CATEGORIES = ['alert', 'notification', 'report', 'custom'] as const
type TemplateCategory = typeof VALID_CATEGORIES[number]

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/

interface GeneratedVariable {
  name: string
  description: string
  example?: string
}

interface GeneratedTemplate {
  title: string
  key: string
  category: TemplateCategory
  messageBody: string
  variables: GeneratedVariable[]
  explanation: string
  rejectedVariables?: string[]
}

function buildSystemPrompt(scopes?: VariableScope[]): string {
  // Pipeline notification templates: фильтруем только pipeline-scope переменные
  const variablesCatalog = registryForAiPrompt(scopes ?? ['pipeline', 'system'])

  return `Ты — AI-помощник платформы автоматизации видеоконтента ZavodCamp.
Твоя задача — генерировать шаблоны Telegram-уведомлений по описанию пользователя.

КРИТИЧНО: Используй ТОЛЬКО переменные из каталога ниже. НЕ выдумывай новые переменные!
Обрати внимание на пометки доступности: [всегда доступна], [доступна из pipeline summary], [доступна при определённых условиях].
Предпочитай переменные, которые «всегда доступны» или «доступны из pipeline summary».
Переменные с пометкой «при определённых условиях» (ошибки) используй только в шаблонах для ошибок.

Допустимые переменные:
${variablesCatalog}

Правила:
- Генерируй шаблон на русском языке, если пользователь пишет на русском.
- Переменные в тексте шаблона оформляй в формате {{имяПеременной}} (двойные фигурные скобки).
- Используй ТОЛЬКО переменные из каталога выше. Любая переменная, которой нет в каталоге, будет отклонена.
- Ключ шаблона (key) — snake_case, латиницей, начинается с буквы.
- Категории шаблонов:
  - alert — оповещение (критические события, ошибки, сбои)
  - notification — уведомление (информирование о событиях, статусах)
  - report — отчёт (сводки, статистика, результаты)
  - custom — пользовательский (всё остальное)
- Текст шаблона (messageBody) должен быть лаконичным, информативным, с эмодзи где уместно.
- Пояснение (explanation) — 1-2 предложения, почему шаблон структурирован именно так.
- НЕ используй условные выражения, тернарные операторы, сравнения или любую логику в тексте шаблона.
  Плохо: {{errorsCount}} > 0 ? "Ошибка" : "Всё ок"
  Хорошо: Ошибок: {{errorsCount}}
- Шаблон — это ТОЛЬКО текст с {{переменными}}, без кода, условий или вычислений.
- Не генерируй секреты, токены, пароли, API-ключи, приватные URL.
- Не генерируй исполняемый код.

Отвечай СТРОГО в формате JSON:
{
  "title": "Человекочитаемое название шаблона",
  "key": "snake_case_ключ",
  "category": "alert|notification|report|custom",
  "messageBody": "Текст шаблона с {{переменными}}",
  "variables": [
    { "name": "имяПеременной", "description": "Для чего эта переменная", "example": "Пример значения" }
  ],
  "explanation": "Почему шаблон структурирован именно так"
}

Ответь ТОЛЬКО JSON-объектом, без обёрток, пояснений и markdown-блоков.`
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{ prompt: string }>(event)

  if (!body?.prompt?.trim()) {
    throw createError({ statusCode: 400, message: 'Промт обязателен' })
  }

  const prompt = body.prompt.trim()

  if (prompt.length > 2000) {
    throw createError({ statusCode: 400, message: 'Промт слишком длинный (макс. 2000 символов)' })
  }

  const userPrompt = `Описание шаблона от пользователя: "${prompt}"

Сгенерируй один Telegram-шаблон уведомления по этому описанию.
Используй ТОЛЬКО переменные из каталога в системном промте.
Ответь ТОЛЬКО JSON-объектом.`

  const allowedKeys = new Set(getAllVariableKeys())

  let capturedUsage: import('~~/server/utils/ai-pricing').AnthropicUsage | null = null
  const result = await callAnthropicAgent<GeneratedTemplate>({
    onUsage: (u) => { capturedUsage = u },
    systemPrompt: buildSystemPrompt(),
    userPrompt,
    tier: 'haiku',
    maxTokens: 1024,
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>

      if (typeof d.title !== 'string' || !d.title.trim()) {
        throw new Error('title должен быть непустой строкой')
      }

      if (typeof d.key !== 'string' || !KEY_PATTERN.test(d.key)) {
        throw new Error('key должен быть snake_case строкой, начинающейся с буквы')
      }

      if (!VALID_CATEGORIES.includes(d.category as TemplateCategory)) {
        throw new Error(`category должен быть одним из: ${VALID_CATEGORIES.join(', ')}`)
      }

      if (typeof d.messageBody !== 'string' || !d.messageBody.trim()) {
        throw new Error('messageBody должен быть непустой строкой')
      }

      if (!Array.isArray(d.variables)) {
        throw new Error('variables должен быть массивом')
      }

      const variables: GeneratedVariable[] = (d.variables as unknown[]).map((v, i) => {
        const variable = v as Record<string, unknown>
        if (typeof variable.name !== 'string' || !variable.name.trim()) {
          throw new Error(`variables[${i}].name должен быть непустой строкой`)
        }
        if (typeof variable.description !== 'string' || !variable.description.trim()) {
          throw new Error(`variables[${i}].description должен быть непустой строкой`)
        }
        return {
          name: variable.name.trim(),
          description: variable.description.trim(),
          example: typeof variable.example === 'string' ? variable.example.trim() : undefined,
        }
      })

      // Валидация по registry: отклоняем выдуманные переменные
      const bodyValidation = validateTemplateBody((d.messageBody as string).trim())
      const rejectedVariables = bodyValidation.invalid

      // Заменяем недопустимые переменные в messageBody на пустую строку
      let cleanBody = (d.messageBody as string).trim()
      for (const invalid of rejectedVariables) {
        cleanBody = cleanBody.replace(new RegExp(`\\{\\{${invalid}\\}\\}`, 'g'), '')
      }

      // Strip unsupported expressions
      cleanBody = cleanBody
        .split('\n')
        .filter((line: string) => {
          const t = line.trim()
          if (/^.+\?\s*["'«"].+["'»"]\s*:\s*["'«"].+["'»"]\s*$/.test(t)) return false
          if (/\{\{.*\}\}\s*[><=!]+\s*\d+/.test(t)) return false
          return true
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')

      // Фильтруем variables: оставляем только допустимые
      const validVariables = variables.filter(v => allowedKeys.has(v.name))

      return {
        title: d.title.trim(),
        key: d.key,
        category: d.category as TemplateCategory,
        messageBody: cleanBody,
        variables: validVariables,
        explanation: typeof d.explanation === 'string' ? d.explanation.trim() : '',
        rejectedVariables: rejectedVariables.length > 0 ? rejectedVariables : undefined,
      }
    },
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

  return {
    data: {
      title: result.title,
      key: result.key,
      category: result.category,
      messageBody: result.messageBody,
      variables: result.variables,
      explanation: result.explanation,
      rejectedVariables: result.rejectedVariables,
      auditId,
    },
  }
})
