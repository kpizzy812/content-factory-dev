/**
 * Пост-валидация Kling-промптов через Haiku-агента scene-prompt-validator.
 *
 * Логирует diff (какие issues fixed). При ошибке валидатора — graceful return
 * исходных scenes (не блокируем pipeline).
 */

import { validateScenePrompts } from "../agents/scene-prompt-validator"
import type { SceneImagePrompts } from "./types"

export async function validateScenePromptsCoherence(
  scenes: SceneImagePrompts["scenes"],
): Promise<SceneImagePrompts["scenes"]> {
  if (scenes.length === 0) return scenes

  try {
    const validated = await validateScenePrompts(scenes)

    // Защита от truncation Haiku-ответа (max_tokens) — если валидатор вернул
    // меньше сцен чем пришло на вход, downstream pipeline сломается на индексах
    // clipPaths. Возвращаем оригинал, не теряя сцены.
    if (validated.scenes.length !== scenes.length) {
      console.warn(
        `[scene-prompt-validator] count mismatch: got ${validated.scenes.length}, expected ${scenes.length} — using original scenes`,
      )
      return scenes
    }

    const allIssues = validated.scenes.flatMap((s) => s.fixedIssues ?? [])
    if (allIssues.length > 0) {
      console.info(`[scene-prompt-validator] fixed ${allIssues.length} issues:`, allIssues)
    }
    // Возвращаем без поля fixedIssues — оно нужно только для логов.
    return validated.scenes.map(({ order, prompt, purpose }) => ({ order, prompt, purpose }))
  } catch (err) {
    console.warn("[scene-prompt-validator] failed, returning original scenes:", err)
    return scenes
  }
}
