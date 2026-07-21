/**
 * Platform Adaptation Agent — адаптация сценария под разные платформы.
 * Переписывает скрипт, подстраивает хронометраж и оверлеи.
 */
import type {
  PlatformAdaptationInput,
  PlatformAdaptationResult,
  PlatformAdaptation,
} from '~~/shared/types/agents'

const SYSTEM_PROMPT = `Ты — продюсер коротких видео. Адаптируешь один сценарий под разные платформы: TikTok (15-60s, вертикальное, быстрый монтаж), Instagram Reels (15-90s, эстетика, музыка), YouTube Shorts (до 60s, SEO-заголовок, субтитры). Отвечай на русском. Отвечай СТРОГО в формате JSON.`

function buildPrompt(input: PlatformAdaptationInput): string {
  const platformsList = input.platforms.join(', ')

  return `Адаптируй сценарий для разных платформ.

## Исходный сценарий
- Название: ${input.scenario.title}
- Хук: ${input.scenario.hook}
- Основная часть: ${input.scenario.body}
- CTA: ${input.scenario.cta}
${input.scenario.visualStyle ? `- Визуальный стиль: ${input.scenario.visualStyle}` : ''}

## Платформы: ${platformsList}

## Задача
Сгенерируй JSON-объект с полем adaptations. Ключи — названия платформ, значения:
- script: переписанный скрипт для данной платформы
- editingNotes: заметки по монтажу (темп, переходы, эффекты)
- textOverlays: массив строк — текстовые оверлеи для видео
- duration: рекомендуемая длительность ("30s", "45s", "60s")

Ответь ТОЛЬКО JSON-объектом с полем adaptations.`
}

function validate(data: unknown): PlatformAdaptationResult {
  const d = data as Record<string, unknown>

  if (!d.adaptations || typeof d.adaptations !== 'object') {
    throw new Error('Некорректный формат: ожидался объект adaptations')
  }

  const adaptations = d.adaptations as Record<string, unknown>
  for (const [platform, adaptation] of Object.entries(adaptations)) {
    const a = adaptation as Record<string, unknown>
    if (
      typeof a.script !== 'string'
      || typeof a.editingNotes !== 'string'
      || !Array.isArray(a.textOverlays)
      || typeof a.duration !== 'string'
    ) {
      throw new Error(`Адаптация для ${platform}: некорректный формат`)
    }
  }

  return d as unknown as PlatformAdaptationResult
}

export async function runPlatformAdaptationAgent(
  input: PlatformAdaptationInput,
): Promise<PlatformAdaptationResult> {
  return callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: 4096,
    validate,
  })
}
