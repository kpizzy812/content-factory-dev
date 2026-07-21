/**
 * Posting Time Agent — оптимальное время публикации.
 * Учитывает платформу, гео и нишу.
 */
import type { PostingTimeInput, PostingTimeResult, BestTimeSlot } from '~~/shared/types/agents'

const SYSTEM_PROMPT = `Ты — эксперт по SMM-аналитике. Знаешь оптимальные часы публикации для каждой платформы в каждом регионе. Учитываешь часовые пояса, специфику аудитории ниши и алгоритмы рекомендаций. Отвечай на русском. Отвечай СТРОГО в формате JSON.`

function buildPrompt(input: PostingTimeInput): string {
  return `Определи лучшее время для публикации контента.

## Параметры
- Платформа: ${input.platform}
- Гео (регион аудитории): ${input.geo}
- Ниша: ${input.niche || 'общая'}
- Часовой пояс: ${input.timezone || 'Europe/Moscow'}

## Задача
Сгенерируй JSON-объект:
- bestTimes: массив из 5-7 объектов лучших слотов:
  - day: день недели (Понедельник, Вторник, ...)
  - hour: время (например "18:00-20:00")
  - reason: короткое объяснение, почему это время хорошее
- avoidTimes: массив из 3-5 строк — когда НЕ стоит публиковать и почему
- timezone: строка — использованный часовой пояс

Ответь ТОЛЬКО JSON-объектом.`
}

function validate(data: unknown): PostingTimeResult {
  const d = data as Record<string, unknown>

  if (
    !Array.isArray(d.bestTimes)
    || !Array.isArray(d.avoidTimes)
    || typeof d.timezone !== 'string'
  ) {
    throw new Error('Некорректный формат ответа PostingTimeAgent')
  }

  for (let i = 0; i < d.bestTimes.length; i++) {
    const slot = d.bestTimes[i] as Record<string, unknown>
    if (
      typeof slot.day !== 'string'
      || typeof slot.hour !== 'string'
      || typeof slot.reason !== 'string'
    ) {
      throw new Error(`Слот ${i + 1}: некорректный формат`)
    }
  }

  return d as unknown as PostingTimeResult
}

export async function runPostingTimeAgent(input: PostingTimeInput): Promise<PostingTimeResult> {
  return callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    tier: 'haiku',
    maxTokens: 2048,
    validate,
  })
}
