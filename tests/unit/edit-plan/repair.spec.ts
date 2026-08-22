import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import { repairShotPlan } from "~~/server/utils/edit-plan/repair"
import { validateShotPlan } from "~~/server/utils/edit-plan/validate"
import type { PlannedShot } from "~~/server/utils/edit-plan/types"

const WORDS = [
  { text: "первое", startSec: 0, endSec: 0.9, matched: true },
  { text: "второе", startSec: 1.0, endSec: 1.9, matched: true },
  { text: "третье", startSec: 2.1, endSec: 3.0, matched: true },
]

function context(shots: PlannedShot[], overrides: Record<string, unknown> = {}) {
  return {
    plan: { shots },
    trackDurationSec: 3.0,
    fps: 30,
    alignedScenes: [{ order: 1, startSec: 0, endSec: 3.0, words: WORDS }],
    profile: DEFAULT_EDIT_PROFILE,
    lipSyncMaxDurationSec: 10,
    minGenerativeVideoSec: 5,
    knownBackgroundIds: new Set<string>(),
    ...overrides,
  } as never
}

const base: PlannedShot = {
  order: 0, startSec: 0, endSec: 3, sceneOrder: 1,
  foreground: "none", background: "none",
  backgroundClipId: null, appReferenceId: null, idea: null, pipEnabled: false,
}

describe("детерминированный ремонт плана кадров", () => {
  it("притягивает границу к ближайшему межсловному интервалу", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.4 },
      { ...base, order: 1, startSec: 1.4, endSec: 3.0 },
    ]))

    // 1.4 — середина слова «второе» (1.0-1.9). Межсловных щелей две: (0.9, 1.0)
    // и (1.9, 2.1). До середины первой (0.95) — 0.45 с, до середины второй
    // (2.0) — 0.6 с. Ближайшая — (0.9, 1.0).
    expect(plan.shots[0]!.endSec).toBeGreaterThanOrEqual(0.9)
    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(1.0)
    expect(plan.shots[1]!.startSec).toBeCloseTo(plan.shots[0]!.endSec, 6)
  })

  it("закрывает дыру, а не оставляет её следующему проходу", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.0 },
      { ...base, order: 1, startSec: 1.5, endSec: 3.0 },
    ]))

    expect(plan.shots[1]!.startSec).toBeCloseTo(plan.shots[0]!.endSec, 6)
  })

  it("срезает нахлёст по началу следующего кадра", () => {
    // startSec второго кадра — 1.95, а не ближе к 2.1: с 2.1 подобранная для
    // первого кадра точка (2.0, середина щели 1.9-2.1) сама по себе меньше
    // 2.1, и тест проходил бы, даже если бы repair вообще не подтягивал старт
    // ВТОРОГО кадра к концу первого — совпадение чисел маскировало бы дыру в
    // логике. При 1.95 подобранная точка (2.0) больше исходного старта, и без
    // подтяжки нахлёст остался бы виден.
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 2.4 },
      { ...base, order: 1, startSec: 1.95, endSec: 3.0 },
    ]))

    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(plan.shots[1]!.startSec + 1e-6)
  })

  it("подтягивает начало первого кадра к нулю, даже если план начинается не с нуля", () => {
    // Отдельно от «закрывает дыру»: там дыра МЕЖДУ кадрами. Здесь первый кадр
    // сам не начинается в нуле — без явного шага для index === 0 в repair.ts
    // граница осталась бы висеть в 0.5 с, и первые полсекунды трека остались
    // бы ничем не покрыты.
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0.5, endSec: 1.4 },
      { ...base, order: 1, startSec: 1.4, endSec: 3.0 },
    ]))

    expect(plan.shots[0]!.startSec).toBe(0)
  })

  it("тянет последний кадр до конца трека", () => {
    const { plan } = repairShotPlan(context([{ ...base, order: 0, startSec: 0, endSec: 2.0 }]))

    expect(plan.shots[plan.shots.length - 1]!.endSec).toBeCloseTo(3.0, 3)
  })

  it("обрезает кадр, вылезший за конец трека", () => {
    const { plan } = repairShotPlan(context([{ ...base, order: 0, startSec: 0, endSec: 4.5 }]))

    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(3.0 + 1e-6)
  })

  it("прижимает конец последнего кадра к trackEndFrame, а не к округлению вверх", () => {
    // trackDurationSec = 3.02 с: 3.02 * 30 = 90.6 кадра. trackEndFrame
    // (floor) даёт 90/30 = 3.0 — границу НЕ ПОЗЖЕ конца трека. snapSecToFrame
    // (round) дал бы 91/30 ≈ 3.0333 — за пределами реальной длины звука.
    const { plan } = repairShotPlan(context(
      [{ ...base, order: 0, startSec: 0, endSec: 2.0 }],
      { trackDurationSec: 3.02 },
    ))

    expect(plan.shots[0]!.endSec).toBeCloseTo(3.0, 6)
    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(3.02)
  })

  it("деградирует генеративное видео на коротком кадре до картинки", () => {
    // §10: такая заявка отклоняется валидацией ДО оплаты, а кадр идёт
    // картинкой с движением.
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 2.0, background: "video" },
      { ...base, order: 1, startSec: 2.0, endSec: 3.0 },
    ]))

    expect(plan.shots[0]!.background).toBe("image")
  })

  it("не трогает генеративное видео на кадре достаточной длины", () => {
    // Зеркало предыдущего теста: минимум опущен до 1 с, кадр длится 2 с —
    // «video» не должен деградировать сам по себе, только относительно порога.
    const { plan } = repairShotPlan(context(
      [{ ...base, order: 0, startSec: 0, endSec: 2.0, background: "video" }],
      { trackDurationSec: 2.0, minGenerativeVideoSec: 1 },
    ))

    expect(plan.shots[0]!.background).toBe("video")
  })

  it("сбрасывает ссылку на несуществующий фон у безликого кадра в картинку", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, background: "library", backgroundClipId: "нет-такого" },
    ]))

    expect(plan.shots[0]!.background).toBe("image")
    expect(plan.shots[0]!.backgroundClipId).toBeNull()
  })

  it("сбрасывает несуществующий фон у presenter-кадра в none, а не в картинку", () => {
    // Presenter занимает весь экран — ему не нужен сгенерированный фон,
    // в отличие от безликого кадра (см. предыдущий тест).
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, foreground: "presenter", background: "library", backgroundClipId: "нет-такого" },
    ]))

    expect(plan.shots[0]!.background).toBe("none")
    expect(plan.shots[0]!.backgroundClipId).toBeNull()
  })

  it("не трогает ссылку на фон, который есть в библиотеке", () => {
    const { plan } = repairShotPlan(context(
      [{ ...base, order: 0, background: "library", backgroundClipId: "клип-1" }],
      { knownBackgroundIds: new Set(["клип-1"]) },
    ))

    expect(plan.shots[0]!.background).toBe("library")
    expect(plan.shots[0]!.backgroundClipId).toBe("клип-1")
  })

  it("после ремонта план проходит проверку покрытия", () => {
    const ctx = context([
      { ...base, order: 0, startSec: 0, endSec: 1.4 },
      { ...base, order: 1, startSec: 1.6, endSec: 2.8 },
    ])
    const { plan } = repairShotPlan(ctx)

    const codes = validateShotPlan({ ...(ctx as never), plan } as never).map(v => v.code)
    expect(codes).not.toContain("gap")
    expect(codes).not.toContain("overlap")
    expect(codes).not.toContain("word_split")
  })

  it("перенумеровывает кадры подряд с нуля", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 7, startSec: 1.9, endSec: 3.0 },
      { ...base, order: 3, startSec: 0, endSec: 1.9 },
    ]))

    expect(plan.shots.map(s => s.order)).toEqual([0, 1])
    expect(plan.shots[0]!.startSec).toBeCloseTo(0, 6)
  })

  it("возвращает список того, что чинил — молчать о ремонте нельзя", () => {
    const { repaired } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.0 },
      { ...base, order: 1, startSec: 1.5, endSec: 3.0 },
    ]))

    expect(repaired.length).toBeGreaterThan(0)
    expect(repaired.map(v => v.code)).toContain("gap")
  })

  it("не падает на пустом плане и сообщает о нём в repaired", () => {
    const { plan, repaired } = repairShotPlan(context([]))

    expect(plan.shots).toEqual([])
    expect(repaired.map(v => v.code)).toContain("empty")
  })

  it("не мутирует входной план", () => {
    const shots: PlannedShot[] = [
      { ...base, order: 0, startSec: 0, endSec: 1.0 },
      { ...base, order: 1, startSec: 1.5, endSec: 3.0 },
    ]
    const snapshot = JSON.parse(JSON.stringify(shots))

    repairShotPlan(context(shots))

    expect(shots).toEqual(snapshot)
  })
})
