/**
 * POST /api/ai/suggest/scenario-config
 *
 * Section-level AI autofill for scenario node configuration.
 * Supports: all sections at once, or individual sections.
 * Understands cross-section dependencies (app → storytelling → subtitles).
 * Logs to AiAuditLog.
 */

const VALID_SECTIONS = ['all', 'storytelling', 'subtitles', 'app', 'voiceover'] as const
type Section = typeof VALID_SECTIONS[number]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    prompt: string
    section: Section
    currentConfig?: {
      storytelling?: Record<string, unknown>
      subtitles?: Record<string, unknown>
      app?: Record<string, unknown>
      voiceover?: Record<string, unknown>
    }
    pipelineId?: number
    nodeCanvasId?: string
  }>(event)

  if (!body?.prompt?.trim()) {
    throw createError({ statusCode: 400, message: 'Промт обязателен' })
  }

  const section = body.section || 'all'
  if (!VALID_SECTIONS.includes(section)) {
    throw createError({ statusCode: 400, message: `Неизвестная секция: ${section}` })
  }

  const prompt = body.prompt.trim()
  const current = body.currentConfig ?? {}

  // Load app context if an app is selected
  let appContext = ''
  const appId = current.app?.appId ? Number(current.app.appId) : null
  if (appId) {
    const app = await prisma.app.findUnique({
      where: { id: appId },
      select: {
        name: true,
        description: true,
        brandTone: true,
        corePain: true,
        coreOutcome: true,
        transformationPromise: true,
      },
    })
    if (app) {
      appContext = `\n## Выбранное приложение: "${app.name}"
- Описание: ${app.description || '—'}
- Тон бренда: ${app.brandTone || '—'}
- Боль: ${app.corePain || '—'}
- Результат: ${app.coreOutcome || '—'}
- Трансформация: ${app.transformationPromise || '—'}`
    }
  }

  // Load apps list for app section
  let appsList = ''
  if (section === 'all' || section === 'app') {
    const apps = await prisma.app.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    appsList = `\nДоступные приложения: ${apps.map(a => `${a.id} ("${a.name}")`).join(', ')}`
  }

  // Build section descriptions for AI
  const sectionDescriptions: Record<string, string> = {
    storytelling: `storytelling — настройки сторителлинга:
- enabled (boolean): включить режим сторителлинга
- protagonistMode ("person"|"object"|"abstract"|"auto"): тип протагониста
- continuityStrictness ("strict"|"moderate"|"relaxed"): строгость continuity
- sceneCountStrategy ("auto"|"minimal"|"detailed"|"cinematic"): стратегия кол-ва сцен
- transformationArcTemplate (string|null): описание дуги трансформации
- emotionalProgression (string[]): последовательность эмоций
- appIntegrationStyle ("native"|"prominent"|"subtle"): стиль интеграции приложения
- environmentCues (string[]): подсказки окружения
- paletteMood (string|null): палитра/настроение
- variationIntensity ("low"|"medium"|"high"): интенсивность вариаций
- antiLoopRules (string[]): правила против повторов
- negativeRules (string[]): запреты`,

    subtitles: `subtitles — настройки субтитров:
- enabled (boolean): включить субтитры
- readabilityLevel ("easy"|"normal"|"dense"): уровень читабельности
- maxLineLength (number, 20-80): макс символов на строку
- maxLines (number, 1-3): макс строк одновременно
- placementStrategy ("auto"|"top"|"center"|"bottom"): размещение
- avoidOcclusion (boolean): избегать перекрытия лиц/UI
- styleConsistency (boolean): единый стиль по сценам
- sceneVariation (boolean): вариации по сценам
- autoHighlight (boolean): авто-выделение ключевых слов`,

    app: `app — контекст приложения:
- appId (number|null): ID приложения из библиотеки${appsList}
- contextMode ("full"|"light"|"manual_only"|"off"): режим контекста
- manualOverrideSummary (string|null): ручной override описания
- appCenterStrength ("strong"|"soft"|"background"): центрированность приложения в сюжете`,

    voiceover: `voiceover — озвучка:
- enabled (boolean): включить план озвучки
- narratorPersona (string|null): персона рассказчика
- pacing ("slow"|"moderate"|"fast"): темп
- syncMode ("scene"|"continuous"|"highlights"): синхронизация`,
  }

  const targetSections = section === 'all'
    ? ['storytelling', 'subtitles', 'app', 'voiceover']
    : [section]

  const fieldsBlock = targetSections
    .map(s => sectionDescriptions[s])
    .join('\n\n')

  const currentBlock = Object.entries(current)
    .filter(([k]) => section === 'all' || k === section)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')

  const userPrompt = `Задача: "${prompt}"
${appContext}

## Секции для заполнения:
${fieldsBlock}

${currentBlock ? `## Текущая конфигурация:\n${currentBlock}\n` : ''}
## Правила
1. Генерируй ТОЛЬКО указанные секции с валидными значениями
2. Учитывай зависимости: выбранное приложение влияет на storytelling, storytelling влияет на subtitles
3. Для tags/arrays — используй массивы строк
4. Для boolean — true/false
5. Если не уверен — пропусти поле
6. Значения должны быть из допустимых enum-ов

## Формат ответа
{
  "suggestions": {
    "storytelling": { ... },
    "subtitles": { ... },
    ...
  },
  "reasoning": "Почему такие значения"
}

Ответь ТОЛЬКО JSON.`

  let capturedUsage: import('~~/server/utils/ai-pricing').AnthropicUsage | null = null
  const result = await callAnthropicAgent({
    systemPrompt: `Ты — AI-помощник для настройки сценариев видео-контента.
Генерируй осмысленные, согласованные настройки для сценарного конвейера.
Учитывай зависимости между секциями: приложение → сторителлинг → субтитры → озвучка.
Отвечай на русском. Строго JSON.`,
    userPrompt,
    maxTokens: 3000,
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>
      if (!d.suggestions || typeof d.suggestions !== 'object') {
        throw new Error('Ожидался объект suggestions')
      }
      return d as { suggestions: Record<string, unknown>; reasoning?: string }
    },
    onUsage: (u) => { capturedUsage = u },
  })

  // Post-generation coherence check
  const suggestions = result.suggestions as Record<string, Record<string, unknown>>
  const coherenceWarnings: string[] = []

  if (suggestions.storytelling && suggestions.subtitles) {
    // Если storytelling enabled, subtitles тоже должны быть enabled
    if (suggestions.storytelling.enabled === true && suggestions.subtitles.enabled === false) {
      suggestions.subtitles.enabled = true
      coherenceWarnings.push('Субтитры включены автоматически — storytelling mode требует субтитров')
    }
  }

  if (suggestions.voiceover && suggestions.storytelling) {
    // Voiceover pacing должен соответствовать storytelling intensity
    if (suggestions.voiceover.enabled && suggestions.storytelling.sceneCountStrategy === 'cinematic') {
      if (suggestions.voiceover.pacing === 'fast') {
        suggestions.voiceover.pacing = 'moderate'
        coherenceWarnings.push('Темп озвучки снижен до moderate — cinematic режим несовместим с fast pacing')
      }
    }
  }

  if (suggestions.app && suggestions.storytelling) {
    // Если app выбрано, но storytelling не enabled — включаем
    if (suggestions.app.appId && !suggestions.storytelling.enabled) {
      coherenceWarnings.push('Storytelling рекомендуется при подключённом приложении для better integration')
    }
    // Если storytelling включён и app выбрано, но appIntegrationStyle не задан — ставим default
    if (suggestions.storytelling.enabled && suggestions.app.appId && !suggestions.storytelling.appIntegrationStyle) {
      suggestions.storytelling.appIntegrationStyle = 'native'
      coherenceWarnings.push('appIntegrationStyle установлен в "native" для согласованности с выбранным приложением')
    }
  }

  // AI Audit Trail
  const session = await getUserSession(event)
  const auditUserId = (session?.user as any)?.id ?? 0
  const auditId = await logAiAudit({
    userId: auditUserId,
    action: 'block_suggest',
    nodeType: 'scenario',
    pipelineId: body.pipelineId ?? undefined,
    nodeCanvasId: body.nodeCanvasId ?? undefined,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    prompt,
    suggestions: result.suggestions,
    usage: capturedUsage,
  })

  return {
    data: {
      auditId,
      suggestions: result.suggestions,
      reasoning: result.reasoning || '',
      section,
      coherenceWarnings: coherenceWarnings.length > 0 ? coherenceWarnings : undefined,
    },
  }
})
