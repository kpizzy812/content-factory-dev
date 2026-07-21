/**
 * Character Block Regenerator Agent — точечная AI-регенерация одного поля
 * персонажа (description или visualPrompt) на основе текущего контекста + reason.
 *
 * Используется в POST /api/characters/:id/regenerate для кнопки "AI пересобрать"
 * на странице /characters/[id]. НЕ переиспользует character-photo-analyzer
 * (тот vision-only); здесь чистая TEXT-only регенерация по reason оператора.
 *
 * Модель — Sonnet (consistency с scene-block-regenerator), max_tokens 800.
 * Возвращает строку: для description — русский (3-5 предложений), для
 * visualPrompt — английский 1-line prompt-инжектор (до ~200 символов).
 */
import { callAnthropicAgent } from './call-anthropic'

const MAX_TOKENS = 800

export type CharacterBlockType = 'description' | 'visualPrompt'

export interface CharacterBlockRegenInput {
  character: {
    name: string
    description?: string | null
    visualPrompt?: string | null
    role: string
    ageRange?: string | null
    emotionDefault?: string | null
    tags?: string[]
  }
  app: { name: string; description?: string | null }
  blockType: CharacterBlockType
  reason?: string | null
  /** AI-описания реф-фото персонажа (aiVisualDescription) — учитываются как фактура. */
  referenceDescriptions?: string[]
}

const SYSTEM_PROMPT = `Ты — AI-помощник библиотеки персонажей системы AI-видеогенерации.
Твоя задача — перегенерировать ОДНО поле персонажа: либо текстовое описание (description, русский),
либо short visual prompt (visualPrompt, английский, для FLUX/Kling image generation).
Отвечай СТРОГО валидным JSON. Никаких эмодзи, никаких пояснений вне JSON.`

function buildReferenceBlock(refs?: string[]): string {
  if (!refs || refs.length === 0) return ''
  const lines = refs.slice(0, 5).map((r, i) => `  ${i + 1}. ${r.slice(0, 200)}`).join('\n')
  return `\n## Реф-фото (AI vision описания)\n${lines}\n— учти эти черты при перегенерации, не противоречь им.`
}

function buildCurrentBlock(input: CharacterBlockRegenInput): string {
  const c = input.character
  const lines: string[] = []
  lines.push(`## Персонаж`)
  lines.push(`- Имя: ${c.name}`)
  lines.push(`- Роль: ${c.role}`)
  if (c.ageRange) lines.push(`- Возраст: ${c.ageRange}`)
  if (c.emotionDefault) lines.push(`- Эмоция по умолчанию: ${c.emotionDefault}`)
  if (c.tags?.length) lines.push(`- Теги: ${c.tags.join(', ')}`)
  if (c.description) lines.push(`- Текущее описание: ${c.description.slice(0, 500)}`)
  if (c.visualPrompt) lines.push(`- Текущий visualPrompt: ${c.visualPrompt}`)
  return lines.join('\n')
}

export async function regenerateCharacterBlock(input: CharacterBlockRegenInput): Promise<string> {
  const reasonBlock = input.reason
    ? `\n## Причина (от оператора)\n${input.reason}\n\nУчти это при перегенерации — измени именно то, на что указал оператор, остальное сохрани в духе текущего значения.`
    : ''
  const refsBlock = buildReferenceBlock(input.referenceDescriptions)
  const currentBlock = buildCurrentBlock(input)
  const appBlock = input.app.description
    ? `\n## Приложение\nИмя: ${input.app.name}\nОписание: ${input.app.description.slice(0, 300)}`
    : `\n## Приложение\nИмя: ${input.app.name}`

  if (input.blockType === 'description') {
    const result = await callAnthropicAgent({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Перегенерируй текстовое описание персонажа (русский, 3-5 предложений).

${currentBlock}
${appBlock}${refsBlock}${reasonBlock}

Формат:
- Внешность (что видим в кадре): возраст, цвет волос, тип фигуры, типичная одежда.
- Характер: 1-2 ярких черты.
- Узнаваемые манеры/жесты: 1-2 пункта.

## Формат ответа (JSON)
{
  "value": "новое описание персонажа на русском, 3-5 предложений, без эмодзи"
}`,
      maxTokens: MAX_TOKENS,
      agentName: 'character-block-description',
      validate: (d: unknown) => {
        const data = d as Record<string, unknown>
        if (typeof data.value !== 'string' || !data.value.trim()) {
          throw new Error('Нет поля value')
        }
        return data as { value: string }
      },
    })
    return result.value.trim()
  }

  // visualPrompt
  const result = await callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Перегенерируй visualPrompt персонажа (английский, 1 строка, до ~200 символов).

Назначение: prompt-инжектор для FLUX/Kling image/video generation. Должен описать:
возраст, gender presentation, hair (color + style), сложение, типичная одежда, эмоция,
1-2 узнаваемые черты внешности. Запятая-separated, не предложение.

${currentBlock}
${appBlock}${refsBlock}${reasonBlock}

## Формат ответа (JSON)
{
  "value": "english one-liner, comma-separated, ~150-200 chars, no emoji, no period at end"
}`,
    maxTokens: MAX_TOKENS,
    agentName: 'character-block-visual-prompt',
    validate: (d: unknown) => {
      const data = d as Record<string, unknown>
      if (typeof data.value !== 'string' || !data.value.trim()) {
        throw new Error('Нет поля value')
      }
      return data as { value: string }
    },
  })
  return result.value.trim()
}
