/**
 * Visual Style Agent — арт-директор для AI-генерации видео.
 * Описывает визуал в терминах FLUX/Runway: конкретные цвета, освещение, стиль.
 */
import type { VisualStyleInput, VisualStyleResult, SceneDescription } from '~~/shared/types/agents'

const SYSTEM_PROMPT = `Ты — арт-директор для AI-генерации видео. Описывай визуал в терминах, понятных FLUX/Runway/Midjourney: конкретные цвета (hex), освещение (soft light, rim light, neon glow), стиль (cinematic, flat lay, POV). Каждая сцена — отдельный промпт. Отвечай на русском. Отвечай СТРОГО в формате JSON.`

function buildPrompt(input: VisualStyleInput): string {
  return `Создай визуальный стиль для видео-сценария.

## Сценарий
- Название: ${input.scenario.title}
- Хук: ${input.scenario.hook}
- Основная часть: ${input.scenario.body}
- CTA: ${input.scenario.cta}

## Контекст
- Приложение: ${input.appName}
- Ниша: ${input.niche || 'не определена'}

## Задача
Сгенерируй JSON-объект:
- colorPalette: массив из 5 hex-цветов (основные цвета видео)
- lighting: строка — тип освещения (например "soft diffused light with warm highlights")
- mood: строка — настроение видео
- characterDescription: строка — описание персонажа/ведущего
- imagePromptSuffix: строка — суффикс для промптов генерации изображений
- sceneDescriptions: массив из 3-5 объектов сцен:
  - sceneNumber: номер сцены
  - description: полное описание визуала сцены
  - duration: длительность ("3s", "5s")
  - cameraAngle: ракурс камеры

Ответь ТОЛЬКО JSON-объектом.`
}

function validate(data: unknown): VisualStyleResult {
  const d = data as Record<string, unknown>

  if (
    !Array.isArray(d.colorPalette)
    || typeof d.lighting !== 'string'
    || typeof d.mood !== 'string'
    || typeof d.characterDescription !== 'string'
    || typeof d.imagePromptSuffix !== 'string'
    || !Array.isArray(d.sceneDescriptions)
  ) {
    throw new Error('Некорректный формат ответа VisualStyleAgent')
  }

  for (let i = 0; i < d.sceneDescriptions.length; i++) {
    const scene = d.sceneDescriptions[i] as Record<string, unknown>
    if (
      typeof scene.sceneNumber !== 'number'
      || typeof scene.description !== 'string'
      || typeof scene.duration !== 'string'
      || typeof scene.cameraAngle !== 'string'
    ) {
      throw new Error(`Сцена ${i + 1}: некорректный формат`)
    }
  }

  return d as unknown as VisualStyleResult
}

export async function runVisualStyleAgent(input: VisualStyleInput): Promise<VisualStyleResult> {
  return callAnthropicAgent({
    agentName: 'visual-style',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: 3072,
    validate,
  })
}
