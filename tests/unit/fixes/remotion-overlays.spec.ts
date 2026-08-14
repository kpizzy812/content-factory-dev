/**
 * Анимационная инфографика поверх готового ролика (Remotion).
 *
 * `docs/PROJECT_CONTEXT.md` §5 требует анимационной инфографики; в коде её не
 * было. Remotion рендерит видео из React-кода — он даёт плашки с цифрами,
 * титры и переходы, но НЕ генеративное видео: картинку по-прежнему рисует flux.
 *
 * Лицензия проверена 14.08.2026: для команды до трёх человек Remotion бесплатен
 * и для коммерческого использования.
 *
 * Здесь проверяется план наложения — что, когда и поверх чего. Сам рендер
 * запускает отдельный адаптер, и его наличие в системе не обязательно.
 */

import { describe, expect, it } from "vitest"
import {
  MAX_OVERLAYS_PER_VIDEO,
  planRemotionOverlays,
} from "../../../server/utils/remotion/overlay-plan"
import { isRemotionEnabled } from "../../../server/utils/remotion/render"

const scene = (order: number, durationSec: number, extra: Record<string, unknown> = {}) => ({
  order,
  durationSec,
  spokenLine: null,
  subtitleCopy: "",
  ...extra,
})

describe("planRemotionOverlays", () => {
  it("цифра из сцены превращается в плашку с инфографикой", () => {
    const plan = planRemotionOverlays({
      scenes: [scene(0, 9, { subtitleCopy: "На 35% больше сахара" })],
    })
    expect(plan.overlays).toHaveLength(1)
    expect(plan.overlays[0]).toMatchObject({ kind: "stat", sceneOrder: 0 })
    expect(plan.overlays[0]!.text).toContain("35%")
  })

  it("сцена без цифр плашку не получает", () => {
    // Инфографика на пустом месте — это шум, который отнимает внимание у речи.
    const plan = planRemotionOverlays({
      scenes: [scene(0, 9, { subtitleCopy: "Мы начинали втроём" })],
    })
    expect(plan.overlays).toHaveLength(0)
  })

  it("плашка появляется не в первый миг сцены и не перекрывает её конец", () => {
    // Зритель должен успеть увидеть кадр, а плашка — уйти до склейки.
    const plan = planRemotionOverlays({
      scenes: [scene(0, 9, { subtitleCopy: "Экономия 40% времени" })],
    })
    const overlay = plan.overlays[0]!
    expect(overlay.startSec).toBeGreaterThan(0)
    expect(overlay.startSec + overlay.durationSec).toBeLessThanOrEqual(9)
  })

  it("таймкоды считаются от начала ролика, а не от начала сцены", () => {
    const plan = planRemotionOverlays({
      scenes: [scene(0, 8), scene(1, 9, { subtitleCopy: "Рост в 3 раза" })],
    })
    expect(plan.overlays[0]!.startSec).toBeGreaterThanOrEqual(8)
  })

  it("на сцену ведущей плашка не ставится", () => {
    // Сцена, где человек говорит в кадре, — это лицо и губы. Плашка поверх
    // забирает внимание ровно там, где работает речь.
    const plan = planRemotionOverlays({
      scenes: [scene(0, 9, { spokenLine: "Я потеряла три месяца", subtitleCopy: "Потеряла 3 месяца" })],
    })
    expect(plan.overlays).toHaveLength(0)
  })

  it("число плашек ограничено — иначе ролик превращается в презентацию", () => {
    const scenes = Array.from({ length: 12 }, (_, index) =>
      scene(index, 6, { subtitleCopy: `Пункт ${index + 1}: рост 20%` }))
    const plan = planRemotionOverlays({ scenes })
    expect(plan.overlays.length).toBeLessThanOrEqual(MAX_OVERLAYS_PER_VIDEO)
  })

  it("пустой ролик даёт пустой план, а не ошибку", () => {
    expect(planRemotionOverlays({ scenes: [] }).overlays).toEqual([])
  })

  it("план знает суммарную длительность — она нужна композиции Remotion", () => {
    const plan = planRemotionOverlays({ scenes: [scene(0, 8), scene(1, 9)] })
    expect(plan.totalDurationSec).toBe(17)
  })
})

describe("isRemotionEnabled", () => {
  it("включён по умолчанию — как остальные механизмы сборки", () => {
    // Смена планов и перебивки выключаются явным false; слой инфографики
    // ведёт себя так же, иначе фича есть в коде и мертва на стенде.
    expect(isRemotionEnabled({})).toBe(true)
  })

  it("выключается явным false", () => {
    expect(isRemotionEnabled({ REMOTION_ENABLED: "false" })).toBe(false)
  })

  it("любое другое значение оставляет слой включённым", () => {
    expect(isRemotionEnabled({ REMOTION_ENABLED: "true" })).toBe(true)
    expect(isRemotionEnabled({ REMOTION_ENABLED: "" })).toBe(true)
  })
})
