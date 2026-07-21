/**
 * Hook Agent — генерация хуков для вирусных видео.
 * 6 типов: question, shock, story, controversy, pain_point, promise.
 */
import type { HookAgentInput, HookAgentResult, HookItem } from '~~/shared/types/agents'

const SYSTEM_PROMPT = `Ты — мастер создания хуков для вирусных коротких видео. 6 типов хуков: question (вопрос), shock (шок), story (история), controversy (провокация), pain_point (боль аудитории), promise (обещание). Максимум 10 слов на хук. Хук должен работать без звука (визуально). Поля hook.text и hook.visualCue — НА АНГЛИЙСКОМ (целевая аудитория англоязычная), без эмодзи и спецсимволов. Отвечай СТРОГО в формате JSON.`

function buildPrompt(input: HookAgentInput): string {
  const count = input.count || 6

  return `Сгенерируй ${count} хуков для видео-сценария.

## Сценарий
- Название: ${input.scenario.title}
- Текущий хук: ${input.scenario.hook}
- Основная часть: ${input.scenario.body}
- CTA: ${input.scenario.cta}
${input.scenario.visualStyle ? `- Визуальный стиль: ${input.scenario.visualStyle}` : ''}

## Платформа: ${input.platform || 'все'}

## Задача
Сгенерируй JSON-объект с полем hooks — массив из ${count} объектов:
- text: текст хука (максимум 10 слов)
- type: один из [question, shock, story, controversy, pain_point, promise]
- visualCue: описание визуального сопровождения хука (текст на экране, жест)
- retentionScore: число 1-100 (прогноз удержания аудитории)

Разнообразь типы хуков. Ответь ТОЛЬКО JSON-объектом с полем hooks.`
}

function validate(data: unknown): HookAgentResult {
  const d = data as Record<string, unknown>

  if (!Array.isArray(d.hooks)) {
    throw new Error('Некорректный формат ответа HookAgent: ожидался массив hooks')
  }

  const validTypes = ['question', 'shock', 'story', 'controversy', 'pain_point', 'promise']

  for (let i = 0; i < d.hooks.length; i++) {
    const hook = d.hooks[i] as Record<string, unknown>
    if (
      typeof hook.text !== 'string'
      || typeof hook.type !== 'string'
      || !validTypes.includes(hook.type)
      || typeof hook.visualCue !== 'string'
      || typeof hook.retentionScore !== 'number'
    ) {
      throw new Error(`Хук ${i + 1}: некорректный формат`)
    }
  }

  return d as unknown as HookAgentResult
}

export async function runHookAgent(input: HookAgentInput): Promise<HookAgentResult> {
  return callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    tier: 'haiku',
    maxTokens: 2048,
    validate,
  })
}
