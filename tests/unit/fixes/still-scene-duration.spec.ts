/**
 * Регрессия: перебивка длится столько, сколько звучит её реплика.
 *
 * Жалоба на ролик 24: «на моменте „чем краснее и натуральнее свёкла“ тупо
 * молчание секунды 3 если не больше». Замер: сцена 2 идёт 10 секунд, реплика в
 * ней звучит 4.88 — остаётся 5.1 секунды немого кадра. И субтитр растянут на всё
 * окно клипа, поэтому его хвост висит уже после того, как голос замолчал: со
 * стороны это выглядит как отстающие субтитры.
 *
 * Десять секунд взялись из ограничений Kling (5 или 10, ближайшее). Но перебивка
 * НЕ генерируется text-to-video: это картинка с движением камеры, её длину
 * задаём мы сами, и квантование модели к ней отношения не имеет.
 */

import { describe, expect, it } from "vitest"
import {
  planStillSceneDuration,
  MIN_STILL_SCENE_SEC,
  MAX_STILL_SCENE_SEC,
  VOICE_LEAD_IN_SEC,
  VOICE_TAIL_SEC,
} from "~~/shared/types/video-runtime"

const words = (count: number) => Array.from({ length: count }, (_, i) => `слово${i}`).join(" ")

describe("planStillSceneDuration", () => {
  it("длина перебивки идёт от реплики, а не от плановых десяти секунд", () => {
    // 12 слов при moderate (2.8 слова/с) — 4.29 с речи плюс вдох и хвост.
    // Ровно столько же резервирует раскладка озвучки: лишнего молчания в сцене
    // не остаётся, иначе после каждой мини-фразы висит пауза.
    expect(planStillSceneDuration({ speechText: words(12), pacing: "moderate", plannedSec: 10 }))
      .toBeCloseTo(4.29 + VOICE_LEAD_IN_SEC + VOICE_TAIL_SEC, 1)
  })

  it("длинная реплика не режется под план — перебивке потолок модели не указ", () => {
    // 30 слов = 10.7 с речи: сцена станет длиннее плановых пяти секунд.
    const duration = planStillSceneDuration({ speechText: words(30), pacing: "moderate", plannedSec: 5 })

    expect(duration).toBeGreaterThan(11)
    expect(duration).toBeLessThanOrEqual(MAX_STILL_SCENE_SEC)
  })

  it("сцена без реплики остаётся плановой — считать не от чего", () => {
    expect(planStillSceneDuration({ speechText: "", pacing: "moderate", plannedSec: 8 })).toBe(8)
    expect(planStillSceneDuration({ speechText: null, pacing: "moderate", plannedSec: 8 })).toBe(8)
  })

  it("совсем короткая реплика не даёт мелькающий кадр", () => {
    expect(planStillSceneDuration({ speechText: "Да", pacing: "fast", plannedSec: 10 }))
      .toBe(MIN_STILL_SCENE_SEC)
  })

  it("абсурдно длинная реплика зажимается потолком", () => {
    expect(planStillSceneDuration({ speechText: words(200), pacing: "slow", plannedSec: 10 }))
      .toBe(MAX_STILL_SCENE_SEC)
  })

  it("темп речи учитывается", () => {
    const slow = planStillSceneDuration({ speechText: words(20), pacing: "slow", plannedSec: 10 })
    const fast = planStillSceneDuration({ speechText: words(20), pacing: "fast", plannedSec: 10 })

    expect(slow).toBeGreaterThan(fast)
  })
})
