/**
 * balance_v2: маппинг stepKey × modelId → service.
 *
 * Hardcoded функция, потому что mapping детерминированный и не нуждается в БД.
 * Возвращает null для шагов которые не списываются с external API
 * (assembly — локальный ffmpeg, voiceover с не-fal провайдером и т.п.).
 */

import { getModel } from "../video-models"

export type CostService = "anthropic" | "fal.ai" | "replicate" | "mubert"

/**
 * Возвращает имя сервиса для cost-tracking или null если шаг
 * не списывается с external API.
 *
 * @param stepKey — имя шага из VideoStepKey (TEXT в схеме)
 * @param modelId — id модели (используется для voiceover, где провайдер варьируется)
 */
export function mapStepKeyToService(
  stepKey: string,
  modelId?: string | null,
): CostService | null {
  switch (stepKey) {
    case "prompt_generation":
      return "anthropic"

    case "image_generation":
    case "clip_generation":
      return "fal.ai"

    case "lip_sync_generation": {
      if (!modelId) return "replicate"
      const model = getModel(modelId)
      return model?.provider.toLowerCase().includes("fal")
        ? "fal.ai"
        : "replicate"
    }

    case "music_generation":
      return "mubert"

    case "voiceover_generation": {
      // Voiceover может идти через fal.ai (Kokoro/PlayAI/ElevenLabs)
      // или другого провайдера. Все интегрированные TTS модели сейчас имеют
      // в provider строку "<vendor> / fal.ai", проверяем по includes('fal').
      if (!modelId) return null
      const model = getModel(modelId)
      if (!model) return null
      return model.provider.toLowerCase().includes("fal") ? "fal.ai" : null
    }

    // assembly — локальный ffmpeg, $0, не списываем
    // прочие неизвестные шаги — также null
    default:
      return null
  }
}
