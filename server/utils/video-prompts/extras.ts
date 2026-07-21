/**
 * Extras для generateSceneImagePrompts.
 *
 * Вынесено из ./types.ts, чтобы types.ts не зависел от ../agents/favorite-prompts-loader.
 * Loader импортирует KlingPromptPattern из types.ts — раньше types.ts re-exported
 * LoadedFavoritePrompt обратно, что создавало circular dependency. Сейчас граф:
 *   loader -> types        (KlingPromptPattern)
 *   extras -> loader       (LoadedFavoritePrompt)
 *   index  -> extras+types
 * Циркуляров нет.
 */

import type { LoadedFavoritePrompt } from "../agents/favorite-prompts-loader"

export interface GenerateScenePromptsExtras {
  favoritePrompts?: LoadedFavoritePrompt[]
  platform?: string | null
  format?: "portrait" | "landscape"
  voiceoverLanguage?: string | null
  videoModelId?: string
  /** ID приложения для structured App Context block. */
  appId?: number | null
  /** ID социального аккаунта для structured Account Style block. */
  socialAccountId?: number | null
}
