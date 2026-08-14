/**
 * Смена плана внутри сцены.
 *
 * Сцена длиной 9 секунд идёт одним статичным кадром: удержание падает, а
 * последовательность перцептивных хешей у двух роликов с одной ведущей выходит
 * почти одинаковой — платформы сравнивают именно её. Практика короткого видео
 * держит смену картинки каждые 1.5-2 секунды; медленное движение внутри кадра
 * даёт её без единого лишнего платного вызова, средствами монтажа.
 *
 * Здесь проверяется построение фильтра ffmpeg: сам монтаж запускается только в
 * сборке, а выбор плана и его выражения обязаны проверяться без процесса.
 */

import { describe, expect, it } from "vitest"
import {
  SHOT_VARIATION_PLANS,
  buildShotVariationFilter,
  pickShotVariationPlan,
} from "../../../server/utils/video-tools/shot-variation"

const PORTRAIT = { w: 1080, h: 1920 }

describe("pickShotVariationPlan", () => {
  it("соседние сцены получают разные планы", () => {
    const plans = [0, 1, 2].map(index => pickShotVariationPlan(index))
    expect(new Set(plans).size).toBe(3)
  })

  it("выбор детерминирован: тот же индекс — тот же план", () => {
    // Пересборка ролика обязана давать тот же файл, иначе кеш нормализации и
    // отпечаток уникальности расходятся между прогонами.
    expect(pickShotVariationPlan(4)).toBe(pickShotVariationPlan(4))
  })

  it("отрицательный и дробный индекс не роняют выбор", () => {
    expect(SHOT_VARIATION_PLANS).toContain(pickShotVariationPlan(-3))
    expect(SHOT_VARIATION_PLANS).toContain(pickShotVariationPlan(2.7))
  })
})

describe("buildShotVariationFilter", () => {
  it("кадр на выходе остаётся форматным: обрезка идёт из увеличенного исходника", () => {
    // Выход обязан быть ровно 1080x1920 — иначе concat склеит кадры разных
    // размеров и ролик развалится уже в ffmpeg.
    const filter = buildShotVariationFilter("pan_left", PORTRAIT, 9)
    expect(filter).toContain("crop=1080:1920")
    expect(filter).toMatch(/scale=\d+:\d+/)
  })

  it("движение привязано ко времени сцены, а не к номеру кадра", () => {
    const filter = buildShotVariationFilter("pan_right", PORTRAIT, 9)
    expect(filter).toContain("t/9")
  })

  it("статичный план тоже кадрирует: он отличает сцену от исходника", () => {
    const filter = buildShotVariationFilter("static_tight", PORTRAIT, 9)
    expect(filter).toContain("crop=1080:1920")
    expect(filter).not.toContain("t/")
  })

  it("нулевая и отрицательная длительность не дают деления на ноль", () => {
    for (const duration of [0, -5, Number.NaN]) {
      const filter = buildShotVariationFilter("pan_left", PORTRAIT, duration)
      expect(filter).not.toContain("/0")
      expect(filter).not.toContain("NaN")
    }
  })

  it("все планы дают валидный фильтр для обоих форматов", () => {
    for (const plan of SHOT_VARIATION_PLANS) {
      for (const target of [PORTRAIT, { w: 1920, h: 1080 }]) {
        const filter = buildShotVariationFilter(plan, target, 7)
        expect(filter).toContain(`crop=${target.w}:${target.h}`)
      }
    }
  })

  it("разные планы дают разные фильтры — иначе смены плана нет", () => {
    const filters = SHOT_VARIATION_PLANS.map(plan => buildShotVariationFilter(plan, PORTRAIT, 9))
    expect(new Set(filters).size).toBe(SHOT_VARIATION_PLANS.length)
  })
})
