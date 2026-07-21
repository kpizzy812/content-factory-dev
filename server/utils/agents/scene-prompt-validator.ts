/**
 * scene-prompt-validator — Haiku-агент пост-валидации Kling-промптов.
 *
 * Получает массив сгенерированных Sonnet'ом scene prompts и фиксит конкретные issues:
 *   1. Device-orientation mismatch (screen mentioned without front-facing angle)
 *   2. Brand name leak (явный бренд в прозе)
 *   3. Motion intensity missing
 *   4. ASCII violations (emoji)
 *
 * Длина <200 слов отмечается как fixedIssue, но не "патчится" филлером.
 *
 * Стоимость: ~$0.005 per video (1 Haiku call вместо N).
 */

import { callAnthropicAgent } from "./call-anthropic"

export interface ValidatedScene {
  order: number
  prompt: string
  purpose: string
  fixedIssues?: string[]
}

export interface ValidatedScenes {
  scenes: ValidatedScene[]
}

const SYSTEM_PROMPT = `You are a Kling prompt coherence validator.
You receive an array of scene prompts and check each for these specific issues:

1. Device-orientation mismatch — prompt mentions a screen / display / dashboard but does NOT describe a clear "front-facing" angle (over-shoulder, face-cam, monitor front-on). If ambiguous, REWRITE the relevant clause to make front-facing explicit.

2. Brand name leak — prompt directly mentions a brand/product name in prose. REWRITE to "the app" / "her phone screen" / "the dashboard".

3. Motion intensity missing — prompt does not end with "motion intensity N" where N is 0.3-0.9. ADD with sensible default 0.5.

4. Length below 200 words — leave as-is (do NOT pad with filler), but list as fixedIssue "below_target_length".

5. ASCII violations — emoji or non-Latin pictographs in prose (excluding dialogue inside quotes). REMOVE.

You MUST preserve protagonist consistency, camera direction, action structure. Do NOT add new content. Only fix the specific issues listed above.

Respond ONLY with JSON:
{ "scenes": [{ "order": N, "prompt": "<fixed prompt>", "purpose": "<unchanged>", "fixedIssues": ["..."] }] }

If a scene needed no fixes, still return it with fixedIssues: [].`

function validate(input: unknown): ValidatedScenes {
  if (!input || typeof input !== "object") {
    throw new Error("ValidatedScenes: ожидался object")
  }
  const obj = input as { scenes?: unknown }
  if (!Array.isArray(obj.scenes)) {
    throw new Error("ValidatedScenes.scenes: ожидался array")
  }

  const scenes: ValidatedScene[] = obj.scenes.map((s, i) => {
    if (!s || typeof s !== "object") {
      throw new Error(`ValidatedScenes.scenes[${i}]: ожидался object`)
    }
    const sc = s as Record<string, unknown>
    const order = typeof sc.order === "number" ? sc.order : Number(sc.order)
    const prompt = typeof sc.prompt === "string" ? sc.prompt : ""
    const purpose = typeof sc.purpose === "string" ? sc.purpose : ""

    if (!Number.isFinite(order)) throw new Error(`scenes[${i}].order: not a number`)
    if (prompt.length < 50) throw new Error(`scenes[${i}].prompt: слишком короткий (<50 символов)`)
    if (!purpose) throw new Error(`scenes[${i}].purpose: пустая строка`)

    const fixedIssues = Array.isArray(sc.fixedIssues)
      ? (sc.fixedIssues as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined

    return { order, prompt, purpose, fixedIssues }
  })

  return { scenes }
}

export async function validateScenePrompts(
  scenes: Array<{ order: number; prompt: string; purpose: string }>,
): Promise<ValidatedScenes> {
  const userPrompt = `Validate and fix these scene prompts:\n\n${JSON.stringify({ scenes }, null, 2)}\n\nReturn JSON.`

  return callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    tier: "haiku",
    maxTokens: 6144,
    validate,
  })
}
