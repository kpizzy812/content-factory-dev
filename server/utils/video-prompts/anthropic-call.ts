/**
 * Обёртка над callAnthropicAgentCached для генерации Kling per-scene промптов.
 *
 * Возвращает rawText дополнительно (для PromptGenerationDebug.inputSnapshot).
 */

import { callAnthropicAgentCached } from "../agents/call-anthropic-cached"
import { isAnthropicMockMode } from "../mock/mode"
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

/** Сцена, под которую нужен промпт — минимум, который знает вызывающий. */
export interface ScenePromptSeed {
  order: number
  /** Визуальная подсказка сценариста. Пустая — подставляем внятную заглушку. */
  visualGuidance?: string | null
  purpose?: string | null
}

/**
 * Промпты для мок-режима: по одному на КАЖДУЮ сцену прогона.
 *
 * Статичная фикстура (`tryMockAnthropicAgent`) сюда не годится принципиально:
 * набор order'ов в ней фиксирован, а шаг клипов режет кадры ровно по этому
 * списку — фикстура на шесть сцен дала бы шесть клипов ролику из трёх.
 * Поэтому мок собирается из самих сцен: детерминированно, бесплатно и ровно
 * той длины, что у плана.
 */
export function mockSceneImagePrompts(scenes: readonly ScenePromptSeed[]): SceneImagePrompts {
  return {
    scenes: scenes.map(scene => ({
      order: scene.order,
      prompt: (scene.visualGuidance ?? "").trim() || `mock scene ${scene.order}, cinematic shot`,
      purpose: (scene.purpose ?? "").trim() || `mock purpose ${scene.order}`,
    })),
  }
}

export async function fetchSceneImagePrompts(
  staticSystem: string,
  dynamicUser: string,
  /** Сцены прогона — нужны только мок-режиму, реальный вызов их не читает. */
  mockSeeds: readonly ScenePromptSeed[] = [],
): Promise<{
  result: SceneImagePrompts
  rawText: string
  cacheHit: boolean
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number }
}> {
  // Мок-режим обязан отрабатывать без единого платного вызова: без этой ветки
  // шаг падал на `tryMockAnthropicAgent` («вызван без agentName»), и ролик не
  // собирался на стенде вовсе — ни новым маршрутом, ни прежним.
  if (isAnthropicMockMode() && mockSeeds.length > 0) {
    const result = validateScenes(mockSceneImagePrompts(mockSeeds))
    return {
      result,
      rawText: JSON.stringify(result),
      cacheHit: false,
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    }
  }

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
