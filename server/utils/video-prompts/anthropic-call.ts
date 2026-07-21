/**
 * Обёртка над callAnthropicAgentCached для генерации Kling per-scene промптов.
 *
 * Возвращает rawText дополнительно (для PromptGenerationDebug.inputSnapshot).
 */

import { callAnthropicAgentCached } from "../agents/call-anthropic-cached"
import type { SceneImagePrompts } from "./types"

function validateScenes(input: unknown): SceneImagePrompts {
  if (!input || typeof input !== "object") {
    throw new Error("SceneImagePrompts: ожидался object")
  }
  const obj = input as { scenes?: unknown }
  if (!Array.isArray(obj.scenes) || obj.scenes.length === 0) {
    throw new Error("SceneImagePrompts.scenes: ожидался непустой array")
  }
  const scenes = obj.scenes.map((s, i) => {
    if (!s || typeof s !== "object") throw new Error(`scenes[${i}]: not an object`)
    const sc = s as Record<string, unknown>
    const order = typeof sc.order === "number" ? sc.order : Number(sc.order)
    const prompt = typeof sc.prompt === "string" ? sc.prompt : ""
    const purpose = typeof sc.purpose === "string" ? sc.purpose : ""
    if (!Number.isFinite(order)) throw new Error(`scenes[${i}].order: not a number`)
    if (!prompt) throw new Error(`scenes[${i}].prompt: empty`)
    if (!purpose) throw new Error(`scenes[${i}].purpose: empty`)
    return { order, prompt, purpose }
  })
  return { scenes }
}

export async function fetchSceneImagePrompts(
  staticSystem: string,
  dynamicUser: string,
): Promise<{
  result: SceneImagePrompts
  rawText: string
  cacheHit: boolean
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number }
}> {
  // 8192: Sonnet supports it; per-scene budget ~500 words × ~1.4 tok/word ≈ 700
  // tokens, при 6 сценах + JSON shell остаётся запас. Раньше 6144 на 280 words ×
  // 6 сцен резало хвосты (промпты ~200 слов вместо целевых).
  return callAnthropicAgentCached({
    systemPromptStatic: staticSystem,
    userPrompt: dynamicUser,
    maxTokens: 8192,
    validate: validateScenes,
  })
}
