/**
 * Одна функция цены на все способности.
 *
 * До этого цена считалась в четырёх местах с разными правилами: мегапиксели в
 * video-cost.ts, символы в tts.ts, секунды в media-provider/registry.ts, и
 * отдельный литерал $0.014 продублирован в registry.ts и video-models.ts.
 * Теперь источник один — `spec.billing`, а usage описывает только факт
 * потребления.
 */

import type { MediaBilling, MediaModelSpec, MediaUsage } from "./types"

/** Число секунд/символов должно быть конечным и неотрицательным — иначе это баг вызывающего. */
function requireAmount(value: number | undefined, unit: string, field: string): number {
  if (value === undefined) {
    throw new Error(`estimateMediaCost: единица ${unit} требует usage.${field}`)
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`estimateMediaCost: usage.${field} должен быть неотрицательным конечным числом`)
  }
  return value
}

/**
 * Ставка за секунду выхода.
 *
 * Порядок совпадает с прежним `calcVideoUnitCost` (video-cost.ts:120-128):
 * сначала цена по разрешению (Wan), затем надбавка за встроенное аудио (Kling),
 * иначе базовая. Разрешение проверяется первым, потому что у моделей с
 * byResolution встроенного аудио нет.
 */
function resolveSecondRate(
  billing: Extract<MediaBilling, { unit: "output_second" }>,
  usage: MediaUsage,
): number {
  if (usage.resolution && billing.byResolution) {
    const byResolution = billing.byResolution[usage.resolution]
    if (byResolution !== undefined) return byResolution
  }
  if (usage.withAudio && billing.usdPerSecondWithAudio !== undefined) {
    return billing.usdPerSecondWithAudio
  }
  return billing.usdPerSecond
}

/**
 * Короткая форма `estimateMediaCost(spec, 7)` — число трактуется как секунды
 * выхода. Осталась ради вызовов lip-sync, где длительность и есть вся единица
 * потребления; новый код передаёт `MediaUsage`.
 */
function normalizeUsage(usage: MediaUsage | number): MediaUsage {
  if (typeof usage === "number") {
    if (!Number.isFinite(usage) || usage < 0) {
      throw new Error("Output duration must be a non-negative finite number")
    }
    return { outputSeconds: usage, audioSeconds: usage }
  }
  return usage
}

export function estimateMediaCost(spec: MediaModelSpec, usage: MediaUsage | number): number {
  const normalized = normalizeUsage(usage)
  const billing = spec.billing

  switch (billing.unit) {
    case "output_image":
      return requireAmount(normalized.images, billing.unit, "images") * billing.usdPerImage

    case "output_megapixel":
      return requireAmount(normalized.megapixels, billing.unit, "megapixels") * billing.usdPerMegapixel

    case "output_second":
      return requireAmount(normalized.outputSeconds, billing.unit, "outputSeconds")
        * resolveSecondRate(billing, normalized)

    case "audio_second":
      return requireAmount(
        normalized.audioSeconds ?? normalized.outputSeconds,
        billing.unit,
        "audioSeconds",
      ) * billing.usdPerSecond

    case "character":
      return requireAmount(normalized.characters, billing.unit, "characters") * billing.usdPerCharacter

    case "utf8_byte":
      // Байты, а не символы: у Fish Audio кириллица это два байта на букву,
      // и счёт по длине строки занизил бы смету вдвое.
      return requireAmount(normalized.utf8Bytes, billing.unit, "utf8Bytes") * billing.usdPerByte

    case "hardware_second":
      // Факт — из metrics.predict_time вебхука; пока его нет, смета идёт по
      // оценке из спеки, и в UI такая сумма показывается как «≈».
      return (normalized.hardwareSeconds ?? billing.estimatedSeconds) * billing.usdPerSecond

    case "flat":
      return billing.usd
  }
}

/** Цена, по которой смета показывается пользователю: точная или оценочная. */
export function isEstimatedBilling(billing: MediaBilling): boolean {
  return billing.unit === "hardware_second"
}
