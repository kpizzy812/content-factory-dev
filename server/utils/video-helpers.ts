import { writeFile } from "node:fs/promises"
import type { StoryPlan, SceneCard } from "~~/shared/types/story"
import { generateMockPlaceholder, isMockUrl } from "./mock/fal-mock"

// Re-export Kling per-scene генерации из нового модуля video-prompts.
export { generateSceneImagePrompts } from "./video-prompts"
export type { SceneImagePrompts, PromptGenerationDebug } from "./video-prompts/types"
export type { GenerateScenePromptsExtras } from "./video-prompts/extras"

interface ImagePrompts {
  hook: string
  body: string
  cta: string
}

/**
 * Скачивает файл по URL и сохраняет локально.
 *
 * mock:// URLs обрабатываются специально: вместо реальной загрузки генерится
 * placeholder через ffmpeg (см. server/utils/mock/fal-mock.ts). Это позволяет
 * pipeline'у работать end-to-end в FAL_MOCK_MODE без сетевых запросов.
 */
export async function downloadFile(url: string, destPath: string): Promise<void> {
  if (isMockUrl(url)) {
    await generateMockPlaceholder(url, destPath)
    return
  }
  const response = await $fetch.raw(url, {
    responseType: "arrayBuffer",
  } as Parameters<typeof $fetch>[1])
  const buffer = Buffer.from(response._data as ArrayBuffer)
  await writeFile(destPath, buffer)
}

/**
 * Генерирует промпты для изображений через Anthropic.
 * Если storyPlan доступен — использует scene cards для per-scene промптов.
 * Fallback: старый режим (hook/body/cta).
 */
export async function generateImagePrompts(scenario: {
  hook: string
  body: string
  cta: string
  visualStyle: string
  storyPlan?: StoryPlan | null
}): Promise<ImagePrompts> {
  requirePaidApisEnabled("Anthropic Claude API")

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ""
  if (!anthropicApiKey) {
    throw new Error("API-ключ Anthropic не настроен")
  }

  // Story-driven mode: use scene cards for richer prompts
  const storyContext = scenario.storyPlan
    ? buildStoryDrivenContext(scenario.storyPlan)
    : ""

  const response = await $fetch<{
    content: Array<{ type: string; text?: string }>
  }>("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    timeout: 30_000,
    body: {
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 1024,
      system: "Ты генерируешь промпты для AI-генерации изображений. Отвечай СТРОГО в JSON формате.",
      messages: [
        {
          role: "user",
          content: `Сгенерируй 3 промпта для изображений на английском языке для видео-сценария.

Визуальный стиль: ${scenario.visualStyle}
Хук (начало): ${scenario.hook}
Основная часть: ${scenario.body}
Призыв к действию: ${scenario.cta}
${storyContext}

Верни JSON объект с полями:
- hook: промпт для изображения к хуку (яркое, привлекающее внимание)
- body: промпт для изображения к основной части
- cta: промпт для изображения к призыву к действию

Промпты должны быть детальными (2-3 предложения) и описывать конкретную визуальную сцену.
${scenario.storyPlan ? "ВАЖНО: Герой/объект должен быть визуально ОДИНАКОВЫМ во всех сценах. Используй одни и те же визуальные маркеры." : ""}
Ответь ТОЛЬКО JSON-объектом.`,
        },
      ],
    },
  })

  const textBlock = response.content.find((c) => c.type === "text")
  if (!textBlock?.text) {
    throw new Error("Anthropic вернул пустой ответ для промптов изображений")
  }

  const codeBlockMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlockMatch?.[1] ? codeBlockMatch[1].trim() : textBlock.text.trim()
  const parsed = JSON.parse(raw) as ImagePrompts

  if (!parsed.hook || !parsed.body || !parsed.cta) {
    throw new Error("Некорректный формат промптов изображений")
  }

  return parsed
}

/**
 * Builds story context string for enhanced legacy prompt generation.
 */
function buildStoryDrivenContext(storyPlan: StoryPlan): string {
  return `

## Story Context (для обеспечения continuity)
- Герой: ${storyPlan.protagonist.description}
- Визуальные маркеры: ${storyPlan.protagonist.visualIdentifiers.join(", ")}
- Арка: ${storyPlan.storyArc.premise} → ${storyPlan.storyArc.resolution}
- Master prompt: ${storyPlan.globalVisualSystem.stylePrompt}
- Палитра: ${storyPlan.globalVisualSystem.colorPalette.join(", ")}

## Сцены (для контекста)
${storyPlan.scenes.map((s: SceneCard) => `${s.order}. ${s.setting}: ${s.action} [${s.emotionalState}]`).join("\n")}`
}
