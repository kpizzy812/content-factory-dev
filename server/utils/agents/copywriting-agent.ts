/**
 * Copywriting Agent — копирайтер для соцсетей.
 * Генерирует тексты с учётом лимитов каждой платформы.
 */
import type { CopywritingInput, CopywritingResult, PlatformCopy } from '~~/shared/types/agents'

const SYSTEM_PROMPT = `Ты — копирайтер для соцсетей. Знаешь лимиты: TikTok — 150 символов описание, CTA в первом комментарии. Instagram — 2200 символов + 30 хештегов. YouTube Shorts — SEO-заголовок до 60 символов, описание до 5000 символов. Отвечай на русском. Отвечай СТРОГО в формате JSON.`

function buildPrompt(input: CopywritingInput): string {
  const platformsList = input.platforms.length ? input.platforms.join(', ') : 'tiktok, instagram, youtube'

  return `Напиши тексты для публикации видео на разных платформах.

## Сценарий
- Название: ${input.scenario.title}
- Хук: ${input.scenario.hook}
- Основная часть: ${input.scenario.body}
- CTA: ${input.scenario.cta}

## Приложение: ${input.appName}
## Платформы: ${platformsList}

## Задача
Сгенерируй JSON-объект с полем platformVariants. Ключи — названия платформ, значения — объекты:
- title: заголовок (TikTok — до 150 символов, YouTube — до 60, Instagram — яркий заголовок)
- description: описание (TikTok — коротко, Instagram — развёрнуто с эмодзи, YouTube — SEO)
- hashtags: массив хештегов (TikTok — до 5, Instagram — до 30, YouTube — до 15)
- cta: призыв к действию для данной платформы

Ответь ТОЛЬКО JSON-объектом с полем platformVariants.`
}

function validate(data: unknown): CopywritingResult {
  const d = data as Record<string, unknown>

  if (!d.platformVariants || typeof d.platformVariants !== 'object') {
    throw new Error('Некорректный формат: ожидался объект platformVariants')
  }

  const variants = d.platformVariants as Record<string, unknown>
  for (const [platform, variant] of Object.entries(variants)) {
    const v = variant as Record<string, unknown>
    if (
      typeof v.title !== 'string'
      || typeof v.description !== 'string'
      || !Array.isArray(v.hashtags)
      || typeof v.cta !== 'string'
    ) {
      throw new Error(`Платформа ${platform}: некорректный формат`)
    }
  }

  return d as unknown as CopywritingResult
}

export async function runCopywritingAgent(input: CopywritingInput): Promise<CopywritingResult> {
  return callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    tier: 'haiku',
    maxTokens: 3072,
    validate,
  })
}
