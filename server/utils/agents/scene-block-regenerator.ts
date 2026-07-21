/**
 * Scene Block Regenerator Agent — точечная AI-регенерация одного блока сцены
 * (action / style / environment) на основе текущего состояния + reason.
 *
 * Используется в POST /api/scenes/:id/blocks/:blockId/regenerate для кнопки
 * "🪄 AI" в SceneComposer. НЕ затрагивает character/app_screen/app_context блоки
 * — это селекторы, а не AI-генеративные поля.
 */
import type { SceneBlock, ActionSceneBlock, StyleSceneBlock, EnvironmentSceneBlock } from '~~/shared/types/scene'
import { callAnthropicAgent } from './call-anthropic'

const MAX_TOKENS = 1500

export type RegenerableSceneBlockKind = 'action' | 'style' | 'environment'

export interface SceneBlockRegenInput {
  block: SceneBlock
  scene: { name: string; description?: string | null; tags?: string[] }
  app: { name: string; description?: string | null }
  reason?: string | null
  /** Другие блоки сцены — контекст: что ещё в сцене (для согласованности). */
  otherBlocks?: SceneBlock[]
}

function isRegenerableKind(kind: string): kind is RegenerableSceneBlockKind {
  return kind === 'action' || kind === 'style' || kind === 'environment'
}

function buildContextSummary(blocks: SceneBlock[]): string {
  const lines: string[] = []
  for (const b of blocks) {
    if (b.kind === 'character') lines.push(`- character: ${b.characterId} (action: ${b.action ?? '—'}, emotion: ${b.emotion ?? '—'})`)
    else if (b.kind === 'style') lines.push(`- style: ${b.visualStyle}${b.mood ? `, mood ${b.mood}` : ''}${b.camera ? `, camera ${b.camera}` : ''}`)
    else if (b.kind === 'environment') lines.push(`- environment: ${b.location}${b.timeOfDay ? `, ${b.timeOfDay}` : ''}${b.lighting ? `, ${b.lighting}` : ''}`)
    else if (b.kind === 'action') lines.push(`- action: ${b.description}${b.dialog ? ` (dialog: "${b.dialog}")` : ''}`)
    else if (b.kind === 'app_context') lines.push(`- app_context: ${b.focus}`)
    else if (b.kind === 'app_screen') lines.push(`- app_screen: ${b.referenceImageId} (intent: ${b.intent ?? '—'})`)
  }
  return lines.length ? lines.join('\n') : '(нет других блоков)'
}

export async function regenerateSceneBlockAI(input: SceneBlockRegenInput): Promise<SceneBlock> {
  if (!isRegenerableKind(input.block.kind)) {
    throw new Error(`Регенерация недоступна для блока kind=${input.block.kind}`)
  }

  const contextSummary = buildContextSummary(input.otherBlocks ?? [])
  const reasonBlock = input.reason
    ? `\n## Причина (от оператора)\n${input.reason}\n\nУчти это при перегенерации — измени именно то, на что указал оператор, остальное сохрани в духе текущего блока.`
    : ''

  const sceneBlock = input.scene.description
    ? `\n## Описание сцены\n${input.scene.description}`
    : ''

  const tagsBlock = input.scene.tags?.length
    ? `\n## Теги сцены\n${input.scene.tags.join(', ')}`
    : ''

  const appBlock = input.app.description
    ? `\n## Приложение\nИмя: ${input.app.name}\nОписание: ${input.app.description.slice(0, 300)}`
    : `\n## Приложение\nИмя: ${input.app.name}`

  const systemPrompt = `Ты — AI-помощник для композитора сцен в системе AI-видеогенерации.
Твоя задача — перегенерировать ОДИН блок сцены, сохранив структуру (kind остаётся тот же).
Отвечай СТРОГО валидным JSON. Никаких эмодзи, никаких пояснений вне JSON.`

  if (input.block.kind === 'action') {
    const current = input.block as ActionSceneBlock
    const result = await callAnthropicAgent({
      systemPrompt,
      userPrompt: `Перегенерируй action-блок сцены.
${appBlock}

## Сцена
Имя: ${input.scene.name}${sceneBlock}${tagsBlock}

## Другие блоки сцены
${contextSummary}

## Текущий action блок
- description: ${current.description}
${current.dialog ? `- dialog: ${current.dialog}` : '- dialog: (нет)'}
${reasonBlock}

## Формат ответа (JSON)
{
  "description": "новое описание действия (конкретнее, кинематографично)",
  "dialog": "новая реплика или null"
}`,
      maxTokens: MAX_TOKENS,
      agentName: 'scene-block-action',
      validate: (d: unknown) => {
        const data = d as Record<string, unknown>
        if (typeof data.description !== 'string' || !data.description.trim()) {
          throw new Error('Нет поля description')
        }
        return data as { description: string; dialog?: string | null }
      },
    })
    return {
      id: current.id,
      kind: 'action',
      description: result.description,
      dialog: typeof result.dialog === 'string' && result.dialog.trim() ? result.dialog : undefined,
    }
  }

  if (input.block.kind === 'style') {
    const current = input.block as StyleSceneBlock
    const result = await callAnthropicAgent({
      systemPrompt,
      userPrompt: `Перегенерируй style-блок сцены (визуальный стиль/настроение/камера).
${appBlock}

## Сцена
Имя: ${input.scene.name}${sceneBlock}${tagsBlock}

## Другие блоки сцены
${contextSummary}

## Текущий style блок
- visualStyle: ${current.visualStyle}
${current.mood ? `- mood: ${current.mood}` : '- mood: (нет)'}
${current.camera ? `- camera: ${current.camera}` : '- camera: (нет)'}
${reasonBlock}

## Формат ответа (JSON)
{
  "visualStyle": "описание стиля (русский), 1-2 фразы",
  "mood": "настроение или null",
  "camera": "ракурс/движение камеры или null"
}`,
      maxTokens: MAX_TOKENS,
      agentName: 'scene-block-style',
      validate: (d: unknown) => {
        const data = d as Record<string, unknown>
        if (typeof data.visualStyle !== 'string' || !data.visualStyle.trim()) {
          throw new Error('Нет поля visualStyle')
        }
        return data as { visualStyle: string; mood?: string | null; camera?: string | null }
      },
    })
    return {
      id: current.id,
      kind: 'style',
      visualStyle: result.visualStyle,
      mood: typeof result.mood === 'string' && result.mood.trim() ? result.mood : undefined,
      camera: typeof result.camera === 'string' && result.camera.trim() ? result.camera : undefined,
    }
  }

  // environment
  const current = input.block as EnvironmentSceneBlock
  const result = await callAnthropicAgent({
    systemPrompt,
    userPrompt: `Перегенерируй environment-блок сцены (локация/время суток/освещение/погода).
${appBlock}

## Сцена
Имя: ${input.scene.name}${sceneBlock}${tagsBlock}

## Другие блоки сцены
${contextSummary}

## Текущий environment блок
- location: ${current.location}
${current.timeOfDay ? `- timeOfDay: ${current.timeOfDay}` : '- timeOfDay: (нет)'}
${current.lighting ? `- lighting: ${current.lighting}` : '- lighting: (нет)'}
${current.weather ? `- weather: ${current.weather}` : '- weather: (нет)'}
${reasonBlock}

## Формат ответа (JSON)
{
  "location": "место действия (конкретное)",
  "timeOfDay": "morning/midday/evening/night или null",
  "lighting": "освещение или null",
  "weather": "погода или null"
}`,
    maxTokens: MAX_TOKENS,
    agentName: 'scene-block-environment',
    validate: (d: unknown) => {
      const data = d as Record<string, unknown>
      if (typeof data.location !== 'string' || !data.location.trim()) {
        throw new Error('Нет поля location')
      }
      return data as { location: string; timeOfDay?: string | null; lighting?: string | null; weather?: string | null }
    },
  })
  return {
    id: current.id,
    kind: 'environment',
    location: result.location,
    timeOfDay: typeof result.timeOfDay === 'string' && result.timeOfDay.trim() ? result.timeOfDay : undefined,
    lighting: typeof result.lighting === 'string' && result.lighting.trim() ? result.lighting : undefined,
    weather: typeof result.weather === 'string' && result.weather.trim() ? result.weather : undefined,
  }
}
