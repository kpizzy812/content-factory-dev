/**
 * Регрессия: реплика в кадре, которая звучит дольше потолка lip-sync модели.
 *
 * Ролик 24, сцена 4: Fish прочитал 24 слова за 11.55 с, а kwaivgi/kling-lip-sync
 * принимает исходник максимум 10 с. Фрагмента такой длины в библиотеке нет и быть
 * не может — шаг падал целиком («нет ни фрагмента ведущего, ни портрета, ни
 * сгенерированного клипа»), и ролик не собирался вовсе.
 *
 * Лечится тем же приёмом, которым шаг озвучки укладывает закадровую реплику в
 * сцену: ускорением до 1.2x. 11.55 с → 9.6 с, фраза остаётся целой, а фрагмент
 * под неё в библиотеке уже находится. Сверх 1.2x не ускоряем — там начинается
 * скороговорка, и честнее сказать, что сцена не снимается.
 */

import { describe, expect, it } from "vitest"
import {
  planSpeechFitToModel,
  MAX_SPEECH_SPEEDUP,
} from "../../../server/utils/presenter/scene-clip-mapping"

describe("planSpeechFitToModel", () => {
  it("речь короче потолка — ускорять нечего", () => {
    expect(planSpeechFitToModel(6.7, 10)).toEqual({ speedFactor: 1, fits: true })
  })

  it("речь чуть длиннее потолка укладывается ускорением", () => {
    const plan = planSpeechFitToModel(11.55, 10)

    expect(plan.fits).toBe(true)
    // 11.55 / (10 - 0.15) ≈ 1.173 — в пределах 1.2x.
    expect(plan.speedFactor).toBeCloseTo(1.173, 3)
    expect(11.55 / plan.speedFactor).toBeLessThanOrEqual(10)
  })

  it("речь на границе 1.2x всё ещё укладывается", () => {
    const plan = planSpeechFitToModel(9.85 * MAX_SPEECH_SPEEDUP, 10)

    expect(plan.fits).toBe(true)
    expect(plan.speedFactor).toBeCloseTo(MAX_SPEECH_SPEEDUP, 5)
  })

  it("речь, которую пришлось бы гнать быстрее 1.2x, не укладывается", () => {
    const plan = planSpeechFitToModel(20, 10)

    expect(plan.fits).toBe(false)
    expect(plan.speedFactor).toBe(MAX_SPEECH_SPEEDUP)
  })

  it("неизмеримая речь ускорения не требует — решать не по чему", () => {
    expect(planSpeechFitToModel(Number.NaN, 10)).toEqual({ speedFactor: 1, fits: true })
    expect(planSpeechFitToModel(0, 10)).toEqual({ speedFactor: 1, fits: true })
  })
})
