/**
 * Optimization Memory Agent
 * Извлекает требования и рекомендации из feedback, analytics, reviews
 * для улучшения будущих сценариев.
 */
import type {
  OptimizationRequirement,
  OptimizationMemoryData,
  ScenarioFeedbackDerived,
  FeedbackSentiment,
} from '~~/shared/types/story'

const FEEDBACK_SYSTEM_PROMPT = `Ты — аналитик обратной связи по видеосценариям. Твоя задача — извлечь из текстового отзыва структурированные инсайты: требования, рекомендации, антипаттерны.

Правила:
- Требования (requirements) — то, что ОБЯЗАТЕЛЬНО нужно учесть в будущих сценариях.
- Рекомендации (recommendations) — полезные предложения, но не обязательные.
- Антипаттерны (antiPatterns) — что КАТЕГОРИЧЕСКИ нельзя делать (из ошибок, жалоб, негатива).
- Sentiment — общая тональность отзыва: positive, negative, neutral, mixed.
- keyThemes — ключевые темы, затронутые в отзыве (1-5 слов каждая).

Каждый пункт — короткое, конкретное утверждение (не больше 1-2 предложений).
Отвечай СТРОГО в формате JSON.`

function buildFeedbackPrompt(
  feedbackText: string,
  context?: { scenarioTitle?: string; platform?: string },
): string {
  const parts: string[] = ['## Текст отзыва', feedbackText]

  if (context?.scenarioTitle) {
    parts.push(`\n## Сценарий: ${context.scenarioTitle}`)
  }
  if (context?.platform) {
    parts.push(`## Платформа: ${context.platform}`)
  }

  parts.push(`
## Задача
Извлеки из отзыва структурированные инсайты. Ответь JSON-объектом:
{
  "requirements": ["..."],
  "recommendations": ["..."],
  "antiPatterns": ["..."],
  "sentiment": "positive" | "negative" | "neutral" | "mixed",
  "keyThemes": ["..."]
}

Если какой-то массив пуст — верни пустой массив []. Ответь ТОЛЬКО JSON.`)

  return parts.join('\n')
}

const VALID_SENTIMENTS: FeedbackSentiment[] = ['positive', 'negative', 'neutral', 'mixed']

function validateFeedbackResult(data: unknown): ScenarioFeedbackDerived {
  const d = data as Record<string, unknown>

  if (!Array.isArray(d.requirements)) {
    throw new Error('Некорректный формат: ожидался массив requirements')
  }
  if (!Array.isArray(d.recommendations)) {
    throw new Error('Некорректный формат: ожидался массив recommendations')
  }
  if (!Array.isArray(d.antiPatterns)) {
    throw new Error('Некорректный формат: ожидался массив antiPatterns')
  }
  if (typeof d.sentiment !== 'string' || !VALID_SENTIMENTS.includes(d.sentiment as FeedbackSentiment)) {
    throw new Error(`Некорректный sentiment: ${d.sentiment}`)
  }
  if (!Array.isArray(d.keyThemes)) {
    throw new Error('Некорректный формат: ожидался массив keyThemes')
  }

  return {
    requirements: d.requirements.filter((r): r is string => typeof r === 'string'),
    recommendations: d.recommendations.filter((r): r is string => typeof r === 'string'),
    antiPatterns: d.antiPatterns.filter((r): r is string => typeof r === 'string'),
    sentiment: d.sentiment as FeedbackSentiment,
    keyThemes: d.keyThemes.filter((t): t is string => typeof t === 'string'),
  }
}

// --- Экспортируемые функции ---

/**
 * Собирает optimization memory из БД для приложения или глобально.
 */
export async function buildOptimizationMemory(
  appId?: number | null,
): Promise<OptimizationMemoryData | null> {
  const record = await prisma.scenarioMemory.findFirst({
    where: {
      appId: appId ?? null,
      scope: appId ? 'app' : 'global',
    },
  })

  if (!record) return null

  return record.data as unknown as OptimizationMemoryData
}

/**
 * Извлекает из текстового feedback structured insights через AI.
 */
export async function deriveFeedbackInsights(
  feedbackText: string,
  context?: { scenarioTitle?: string; platform?: string },
): Promise<ScenarioFeedbackDerived> {
  return callAnthropicAgent({
    systemPrompt: FEEDBACK_SYSTEM_PROMPT,
    userPrompt: buildFeedbackPrompt(feedbackText, context),
    tier: 'haiku',
    maxTokens: 2048,
    validate: validateFeedbackResult,
  })
}

/**
 * Обновляет optimization memory новым requirement/recommendation/antiPattern.
 * Лимит: максимум 50 записей в каждом массиве (старые удаляются по createdAt).
 */
export async function updateOptimizationMemory(
  requirement: OptimizationRequirement,
  appId?: number | null,
): Promise<void> {
  const MAX_ENTRIES = 50
  const resolvedAppId = appId ?? null
  const scope = resolvedAppId ? 'app' : 'global'

  const existing = await prisma.scenarioMemory.findFirst({
    where: { appId: resolvedAppId, scope },
  })

  const emptyMemory: OptimizationMemoryData = {
    requirements: [],
    recommendations: [],
    antiPatterns: [],
    lastUpdated: new Date().toISOString(),
  }

  const memory: OptimizationMemoryData = existing
    ? (existing.data as unknown as OptimizationMemoryData)
    : emptyMemory

  // Определяем целевой массив по типу requirement
  const targetKey: keyof Pick<OptimizationMemoryData, 'requirements' | 'recommendations' | 'antiPatterns'> =
    requirement.type === 'requirement'
      ? 'requirements'
      : requirement.type === 'recommendation'
        ? 'recommendations'
        : 'antiPatterns'

  // Добавляем новую запись
  memory[targetKey].push(requirement)

  // Применяем лимит — удаляем старые по createdAt
  if (memory[targetKey].length > MAX_ENTRIES) {
    memory[targetKey] = memory[targetKey]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, MAX_ENTRIES)
  }

  memory.lastUpdated = new Date().toISOString()

  if (existing) {
    await prisma.scenarioMemory.update({
      where: { id: existing.id },
      data: {
        data: memory as any,
        version: { increment: 1 },
      },
    })
  }
  else {
    await prisma.scenarioMemory.create({
      data: {
        appId: resolvedAppId,
        scope,
        data: memory as any,
      },
    })
  }
}
