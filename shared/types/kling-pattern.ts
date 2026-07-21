/**
 * Канонический shared-тип структурного паттерна Kling-промпта.
 *
 * Источник истины — здесь. server/utils/video-prompts/types.ts re-export'ит
 * этот тип, чтобы shared/ не зависел от server/. Валидация (validateKlingPromptPattern)
 * остаётся на серверной стороне, тип же нужен и в UI (FavoritePromptCard).
 */

export interface KlingPromptPattern {
  /** Камера: словарь движений ("slow dolly forward", "static locked-off") */
  camera: string
  /** Освещение: тип света / качество ("harsh rim light", "soft golden hour") */
  lighting: string
  /** Структура действия: temporal pattern ("subject grips object → executes primary action → reaction beat") */
  actionStructure: string
  /** Настроение: ключевые слова ("introspective", "high-energy") */
  mood: string
  /** Интенсивность движения 0.3-0.9 (используется в "motion intensity N") */
  motionIntensity: number
}
