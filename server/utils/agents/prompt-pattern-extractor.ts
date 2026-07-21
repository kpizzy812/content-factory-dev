/**
 * prompt-pattern-extractor — Haiku-агент, извлекающий структурный паттерн
 * из FavoritePrompt.promptText. Результат кешируется в FavoritePrompt.aiPatternAnalysis.
 *
 * Используется fire-and-forget из buildReferencePromptsBlock (горячий путь):
 * первый раз промпт проанализируется на следующем рендере, не блокирует текущий.
 *
 * Защита от бесконечного retry — aiAnalysisAttempts >= 3 → skip.
 */

import { callAnthropicAgent } from "./call-anthropic"
import { validateKlingPromptPattern, type KlingPromptPattern } from "../video-prompts/types"

/**
 * System prompt экспортируется отдельно, чтобы standalone-скрипты
 * (scripts/backfill-favorite-prompt-patterns.ts) могли вызывать Anthropic
 * напрямую через fetch, не таща за собой Nuxt auto-imports.
 */
export const PROMPT_PATTERN_SYSTEM_PROMPT = `You analyze Kling text-to-video prompts and extract their STRUCTURAL pattern.
You DO NOT copy content. You DO extract the abstract pattern of camera, lighting, action structure, mood, and motion intensity.

Respond ONLY with JSON of shape:
{
  "camera": "<camera vocabulary used, e.g. 'slow dolly forward synchronized with action peak'>",
  "lighting": "<lighting style/quality, e.g. 'dramatic rim light from a single hard source'>",
  "actionStructure": "<sequential pattern, e.g. 'subject grips object → executes primary action → reaction beat'>",
  "mood": "<mood keyword(s), e.g. 'cinematic, focused'>",
  "motionIntensity": <decimal between 0.3 and 0.9>
}

Do NOT include the original prompt text. Do NOT add extra fields. JSON only.`

/**
 * Извлекает JSON из ответа Anthropic (text-блок), парсит и валидирует через
 * validateKlingPromptPattern. Поддерживает обёртку в markdown ```json``` блок.
 *
 * Экспортировано для standalone-скриптов (см. PROMPT_PATTERN_SYSTEM_PROMPT).
 * Бросает Error если JSON невалидный или схема не соответствует.
 */
export function parsePatternFromAnthropicResponse(text: string): KlingPromptPattern {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlockMatch ? codeBlockMatch[1]!.trim() : text.trim()
  const parsed = JSON.parse(raw)
  return validateKlingPromptPattern(parsed)
}

export async function extractPromptPattern(
  favoritePromptId: number,
  promptText: string,
): Promise<KlingPromptPattern> {
  const userPrompt = `Extract the structural pattern from this Kling prompt:\n\n"""${promptText}"""\n\nReturn JSON only.`

  const pattern = await callAnthropicAgent({
    agentName: "prompt-pattern-extractor",
    systemPrompt: PROMPT_PATTERN_SYSTEM_PROMPT,
    userPrompt,
    tier: "haiku",
    maxTokens: 4096,
    validate: (data) => validateKlingPromptPattern(data),
  })

  // Cache write — не падаем если другой воркер уже записал или DB временно недоступен.
  await prisma.favoritePrompt.update({
    where: { id: favoritePromptId },
    data: {
      aiPatternAnalysis: pattern as unknown as object,
      aiAnalyzedAt: new Date(),
      aiAnalysisError: null,
    },
  }).catch((err) => {
    console.warn(`[prompt-pattern-extractor] cache write failed for FP#${favoritePromptId}`, err)
  })

  return pattern
}

/**
 * Обёртка для fire-and-forget вызова — не throwit, увеличивает aiAnalysisAttempts при ошибке.
 * Hard cap: при currentAttempts >= 3 просто возвращает (избегаем бесконечного retry в горячем пути).
 */
export async function maybeExtractPromptPatternBackground(
  favoritePromptId: number,
  promptText: string,
  currentAttempts: number,
): Promise<void> {
  if (currentAttempts >= 3) return
  try {
    await extractPromptPattern(favoritePromptId, promptText)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message.slice(0, 500) : "unknown error"
    await prisma.favoritePrompt.update({
      where: { id: favoritePromptId },
      data: {
        aiAnalysisError: errorMessage,
        aiAnalysisAttempts: { increment: 1 },
      },
    }).catch(() => {
      // даже запись ошибки может упасть — не насилуем процесс
    })
  }
}
