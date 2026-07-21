/**
 * Public types & validators для модуля video-prompts.
 *
 * KlingPromptPattern — структурный отпечаток FavoritePrompt, извлекаемый
 * Haiku-агентом prompt-pattern-extractor. Кладётся в FavoritePrompt.aiPatternAnalysis.
 *
 * Валидация — ручная (проект не использует zod). validateKlingPromptPattern
 * бросает если объект невалиден.
 *
 * Внимание: НЕ импортируй здесь LoadedFavoritePrompt из ../agents/favorite-prompts-loader —
 * это создаёт circular dependency (loader сам импортирует KlingPromptPattern отсюда).
 * Клиенты, которым нужен LoadedFavoritePrompt, импортируют его напрямую из loader-модуля.
 */

// Канонический тип живёт в shared/, чтобы UI мог его импортировать без cross-boundary import.
// Здесь — только re-export, чтобы существующие server-side импорты `from "../video-prompts/types"`
// продолжали работать.
export type { KlingPromptPattern } from "~~/shared/types/kling-pattern"
import type { KlingPromptPattern } from "~~/shared/types/kling-pattern"

/** Валидация через ручной guard. Возвращает нормализованный объект или бросает. */
export function validateKlingPromptPattern(input: unknown): KlingPromptPattern {
  if (!input || typeof input !== "object") {
    throw new Error("KlingPromptPattern: ожидался object")
  }
  const obj = input as Record<string, unknown>

  const camera = typeof obj.camera === "string" ? obj.camera.trim() : ""
  const lighting = typeof obj.lighting === "string" ? obj.lighting.trim() : ""
  const actionStructure = typeof obj.actionStructure === "string" ? obj.actionStructure.trim() : ""
  const mood = typeof obj.mood === "string" ? obj.mood.trim() : ""
  const motionRaw = typeof obj.motionIntensity === "number"
    ? obj.motionIntensity
    : Number(obj.motionIntensity)

  if (!camera) throw new Error("KlingPromptPattern.camera: пустая строка")
  if (!lighting) throw new Error("KlingPromptPattern.lighting: пустая строка")
  if (!actionStructure) throw new Error("KlingPromptPattern.actionStructure: пустая строка")
  if (!mood) throw new Error("KlingPromptPattern.mood: пустая строка")
  if (!Number.isFinite(motionRaw)) throw new Error("KlingPromptPattern.motionIntensity: ожидалось число")

  // Кламп в [0.3, 0.9] вместо ошибки — модели иногда выдают 0.5 или 1, нет смысла падать.
  const motionIntensity = Math.min(0.9, Math.max(0.3, motionRaw))

  return { camera, lighting, actionStructure, mood, motionIntensity }
}

/**
 * Per-scene image prompts from StoryPlan.
 * Перенесено из video-helpers.ts.
 */
export interface SceneImagePrompts {
  scenes: Array<{
    order: number
    prompt: string
    purpose: string
  }>
}

/**
 * GenerateScenePromptsExtras живёт в `./extras.ts` — этот файл импортирует
 * LoadedFavoritePrompt из loader, но сам loader не зависит от extras.ts.
 * Так разорван circular import между types.ts ↔ favorite-prompts-loader.ts.
 */

/**
 * Snapshot для VideoGenerationStep.inputSnapshot — отладочный, без секретов.
 * rawResponse может быть усечён до 50KB для защиты от Postgres JSONB лимитов.
 *
 * contextBlocks — конкатенированные dynamic context blocks ДО склеивания с
 * scenesDescription. Эти блоки уходят в user message (НЕ в system), но кешируются
 * Anthropic'ом отдельно от статичного system prompt.
 */
export interface PromptGenerationDebug {
  systemPromptStatic: string
  contextBlocks: string
  userPrompt: string
  rawResponse: string
  validatedScenes: SceneImagePrompts["scenes"]
  cacheHit?: boolean
  blocksUsed: string[]
}
