/**
 * Регрессия: смена плана не трогает клипы, прошедшие lip-sync.
 *
 * Жалоба на ролик 24: «липсинк некачественный». Сравнение кадров показало, что
 * половину беды делает не модель, а монтаж. Нормализация применяет ко ВСЕМ
 * клипам «смену плана»: масштабирует исходник на 12% и вырезает из него окно.
 * На сцене ведущей это значит две вещи сразу:
 *   — рот, который модель только что перерисовала (самое мягкое место кадра),
 *     дополнительно растягивается на 12%;
 *   — окно кропа срезает макушку — на замеренном кадре голова обрезана.
 *
 * Смена плана затевалась ради статичных перебивок: там кадр неподвижен девять
 * секунд и ролик выглядит слайд-шоу. Говорящая голова движется сама, и покупать
 * это движение ценой качества лица незачем.
 */

import { describe, expect, it } from "vitest"
import { planShotVariationForClip, SHOT_VARIATION_PLANS } from "../../../server/utils/video-tools/shot-variation"

describe("planShotVariationForClip", () => {
  it("клип после lip-sync остаётся нетронутым", () => {
    expect(planShotVariationForClip("/a/scene_3_lipsync.mp4", 3, true)).toBeNull()
  })

  it("удлинённый озвучкой клип ведущей — тоже нетронутым", () => {
    expect(planShotVariationForClip("/a/scene_3_lipsync_ext.mp4", 3, true)).toBeNull()
  })

  it("перебивка получает план по своему индексу", () => {
    expect(planShotVariationForClip("/a/scene_2_clip.mp4", 2, true))
      .toBe(SHOT_VARIATION_PLANS[2 % SHOT_VARIATION_PLANS.length])
  })

  it("выключенная смена плана отключает её всем", () => {
    expect(planShotVariationForClip("/a/scene_2_clip.mp4", 2, false)).toBeNull()
  })

  it("пустая ячейка сцены плана не получает", () => {
    expect(planShotVariationForClip("", 1, true)).toBeNull()
  })
})
