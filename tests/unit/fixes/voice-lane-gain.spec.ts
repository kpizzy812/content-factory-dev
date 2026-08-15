/**
 * Регрессия: громкость закадрового голоса приводится ЧИСТЫМ УСИЛЕНИЕМ, а не
 * фильтром `loudnorm` внутри filter_complex.
 *
 * `loudnorm` буферизует три секунды входа и отдаёт их с нулевым PTS. Пока он
 * стоит на файле целиком, это незаметно — сдвигается всё сразу. Но на ОДНОЙ
 * дорожке микса он уводит её вперёд относительно остальных: на ролике 24
 * закадровый голос звучал на 3 секунды раньше картинки, то есть фраза
 * начиналась на чужой сцене и обрывалась. Проверено на стенде: тот же граф без
 * `loudnorm` на дорожке голоса даёт речь ровно там, где её положил микс.
 *
 * Линейный режим `loudnorm` — это и есть постоянное усиление, поэтому считаем
 * его сами: (цель − измеренное). Задержки у `volume` нет.
 */

import { describe, expect, it } from "vitest"
import {
  buildVoiceGainFilter,
  LOUDNESS_TARGET,
  MAX_VOICE_GAIN_DB,
  type LoudnormMeasurement,
} from "../../../server/utils/video-tools/loudness"

function measured(inputI: string): LoudnormMeasurement {
  return {
    inputI,
    inputTp: "-1.23",
    inputLra: "6.80",
    inputThresh: "-28.97",
    targetOffset: "1.09",
  }
}

describe("buildVoiceGainFilter", () => {
  it("поднимает тихую дорожку до цели", () => {
    // Fish отдал −18.54 LUFS при цели −14: не хватает 4.54 дБ.
    expect(buildVoiceGainFilter(measured("-18.54"))).toBe("volume=4.54dB")
  })

  it("прижимает громкую дорожку", () => {
    expect(buildVoiceGainFilter(measured("-11.00"))).toBe("volume=-3.00dB")
  })

  it("дорожка уже на цели — усиление нулевое", () => {
    expect(buildVoiceGainFilter(measured(String(LOUDNESS_TARGET.integratedLufs)))).toBe("volume=0.00dB")
  })

  it("абсурдный замер зажимается пределом, а не выворачивает громкость", () => {
    expect(buildVoiceGainFilter(measured("-70.00"))).toBe(`volume=${MAX_VOICE_GAIN_DB.toFixed(2)}dB`)
    expect(buildVoiceGainFilter(measured("+30.00"))).toBe(`volume=${(-MAX_VOICE_GAIN_DB).toFixed(2)}dB`)
  })

  it("замера нет — дорожка идёт как есть", () => {
    // Прежнее поведение до приведения громкости: общий уровень всё равно
    // доводит второй проход по готовому файлу.
    expect(buildVoiceGainFilter(null)).toBe("volume=1.000")
  })

  it("никогда не отдаёт loudnorm — он и есть причина сдвига", () => {
    expect(buildVoiceGainFilter(measured("-18.54"))).not.toContain("loudnorm")
    expect(buildVoiceGainFilter(null)).not.toContain("loudnorm")
  })

  it("нечитаемый замер не роняет сборку", () => {
    expect(buildVoiceGainFilter(measured("не число"))).toBe("volume=1.000")
  })
})
