/**
 * balance_v2: маппинг stepKey × modelId → service.
 *
 * Hardcoded функция, потому что mapping детерминированный и не нуждается в БД.
 * Возвращает null для шагов которые не списываются с external API
 * (assembly — локальный ffmpeg, voiceover с не-fal провайдером и т.п.).
 */

import { getModel } from "../video-models"
import { findMediaSpec } from "../media-provider/registry"

export type CostService = "anthropic" | "fal.ai" | "replicate" | "mubert"

/**
 * Провайдер по спеке модели, а не по подстроке «fal» в человекочитаемом
 * названии вендора. Спека — единственное место, где провайдер записан явно
 * (`MediaModelSpec.provider`); подстрока врала на каждой модели, у которой
 * вендор и хостинг разные («MiniMax» на Replicate, «Sync.so / fal.ai»).
 *
 * null — модели нет в реестре спек (старый id из БД): решает вызывающий.
 */
function serviceFromSpec(modelId: string | null | undefined): CostService | null {
  if (!modelId) return null
  const spec = findMediaSpec(modelId)
  if (!spec) return null
  return spec.provider === "replicate" ? "replicate" : "fal.ai"
}

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
      // Раньше здесь стоял литерал "fal.ai", не глядя на модель. После перевода
      // кадров и клипов на Replicate это писало бы чужой расход на счётчик fal.
      // Модель вне реестра — оставляем прежний ответ, чтобы не менять историю.
      return serviceFromSpec(modelId) ?? "fal.ai"

    case "lip_sync_generation": {
      if (!modelId) return "replicate"
      const fromSpec = serviceFromSpec(modelId)
      if (fromSpec) return fromSpec
      const model = getModel(modelId)
      return model?.provider.toLowerCase().includes("fal")
        ? "fal.ai"
        : "replicate"
    }

    case "music_generation":
      return "mubert"

    case "voiceover_generation": {
      // Провайдер берётся из спеки. Прежняя ветка возвращала null для всего,
      // что не содержит «fal» в названии вендора, — то есть расход на
      // Replicate-озвучку молча не попадал в отчётность вообще.
      if (!modelId) return null
      const fromSpec = serviceFromSpec(modelId)
      if (fromSpec) return fromSpec
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
