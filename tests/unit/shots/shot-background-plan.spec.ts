import { describe, expect, it } from "vitest"

import { planShotBackgroundExecution, type PlannedShotRow } from "~~/server/utils/edit-plan/shot-background-runner"

function shot(over: Partial<PlannedShotRow> = {}): PlannedShotRow {
  return {
    order: 0, startSec: 0, endSec: 1.8, sceneOrder: 1,
    foreground: "none", background: "image",
    backgroundClipId: null, appReferenceId: null, idea: "идея", pipEnabled: false,
    ...over,
  }
}

const LIMITS = {
  imageUsd: 0.025,
  imageGenerationAllowed: true,
  generativeVideoEnabled: true,
  generativeVideoBudgetUsd: 0.5,
  generativeVideoUsdPerSec: 0.05,
  minGenerativeVideoSec: 5,
  maxGenerativeVideoSec: 10,
  knownBackgroundIds: new Set<string>(["bg1"]),
  knownAppScreenIds: new Set<string>(["scr1"]),
}

describe("планирование производства фонов кадров", () => {
  it("библиотека и скрин приложения бесплатны и в потолок не идут", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [
        shot({ order: 0, background: "library", backgroundClipId: "bg1" }),
        shot({ order: 1, background: "app_screen", appReferenceId: "scr1" }),
      ],
    })
    expect(plan.items.map(i => i.costUsd)).toEqual([0, 0])
    expect(plan.items.map(i => i.countsAgainstBudgetUsd)).toEqual([0, 0])
    expect(plan.promptOrders).toEqual([])
  })

  it("картинка стоит тариф модели и в потолок генеративного видео НЕ идёт (ruling B4-1)", () => {
    const plan = planShotBackgroundExecution({ ...LIMITS, shots: [shot({ background: "image" })] })
    expect(plan.items[0]!.costUsd).toBeCloseTo(0.025, 6)
    expect(plan.items[0]!.countsAgainstBudgetUsd).toBe(0)
    expect(plan.promptOrders).toEqual([0])
  })

  it("генеративное видео квантуется в 5 или 10 секунд и считается по ставке спеки", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [shot({ order: 0, endSec: 6.0, background: "video" })],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "video", billedSec: 10 })
    expect(plan.items[0]!.costUsd).toBeCloseTo(0.5, 6)
    expect(plan.items[0]!.countsAgainstBudgetUsd).toBeCloseTo(0.5, 6)
  })

  it("кадр короче пяти секунд генеративного видео не получает — деградирует до картинки (§7)", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [shot({ endSec: 2.0, background: "video" })],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "image" })
    expect(plan.items[0]!.degradeReason).toBeTruthy()
    expect(plan.items[0]!.costUsd).toBeCloseTo(0.025, 6)
  })

  it("исчерпанный потолок деградирует ПОСЛЕДУЮЩИЕ кадры, а не первый", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      generativeVideoBudgetUsd: 0.5,
      shots: [
        // 5 с → billedSec 5 → $0.25, потолок ещё не исчерпан.
        shot({ order: 0, endSec: 5.0, background: "video" }),
        // 6 с → billedSec 10 → $0.50, а свободно только $0.25 → деградация.
        shot({ order: 1, startSec: 5, endSec: 11.0, background: "video" }),
      ],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "video", billedSec: 5 })
    expect(plan.items[1]!.action).toEqual({ kind: "image" })
    // Сообщение начинается с "Потолок" (заглавная — начало предложения, тот же
    // стиль, что у остальных причин деградации в background-source.ts) —
    // регистронезависимое сравнение вместо точной подстроки из брифа.
    expect(plan.items[1]!.degradeReason).toMatch(/потолок/i)
  })

  it("накопитель потолка не отравляется картинками", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      generativeVideoBudgetUsd: 0.3,
      shots: [
        ...Array.from({ length: 20 }, (_, i) => shot({ order: i, background: "image" })),
        shot({ order: 20, startSec: 40, endSec: 45, background: "video" }),
      ],
    })
    // 20 картинок = $0.50 в costUsd, но в потолок Kling они не пошли,
    // поэтому пятисекундный клип за $0.25 при потолке $0.30 ещё проходит.
    expect(plan.items[20]!.action).toEqual({ kind: "video", billedSec: 5 })
  })

  it("выключенный флаг генеративного видео закрывает его совсем", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS, generativeVideoEnabled: false,
      shots: [shot({ endSec: 8, background: "video" })],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "image" })
  })

  it("выключенная генерация картинок отдаёт кадр ведущему на весь экран (§10)", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS, imageGenerationAllowed: false,
      shots: [shot({ background: "image", foreground: "presenter" })],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "none" })
    expect(plan.items[0]!.costUsd).toBe(0)
    expect(plan.items[0]!.degradeReason).toBeTruthy()
  })

  it("несуществующая ссылка на фон не роняет шаг, а деградирует с причиной", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [shot({ background: "library", backgroundClipId: "нет-такого" })],
    })
    expect(plan.items[0]!.action).not.toEqual({ kind: "library", backgroundClipId: "нет-такого" })
    expect(plan.items[0]!.degradeReason).toBeTruthy()
  })

  it("кадр без фона промпта не просит", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [shot({ background: "none", foreground: "presenter" })],
    })
    expect(plan.promptOrders).toEqual([])
    expect(plan.items[0]!.costUsd).toBe(0)
  })
})
