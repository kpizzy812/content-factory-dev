import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import { MIN_SHOT_SEC, repairShotPlan } from "~~/server/utils/edit-plan/repair"
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
    // (2.0) — 0.6 с. Ближайшая — (0.9, 1.0), и она в пределах окна поиска.
    expect(plan.shots[0]!.endSec).toBeGreaterThanOrEqual(0.9)
    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(1.0)
    expect(plan.shots[1]!.startSec).toBeCloseTo(plan.shots[0]!.endSec, 6)
  })

  it("не двигает границу, которая уже не рвёт слово (Important 1)", () => {
    // 0.92 уже внутри щели (0.9, 1.0) и не рвёт слово «второе» — прежний
    // алгоритм безусловно тянул ЛЮБУЮ границу к середине ближайшей щели
    // (0.95 → 0.9667) даже там, где чинить было нечего. Теперь границу,
    // которая уже безопасна, репэйр только притягивает к кадру.
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 0.92 },
      { ...base, order: 1, startSec: 0.92, endSec: 3.0 },
    ]))

    expect(plan.shots[0]!.endSec).toBeCloseTo(28 / 30, 6)
  })

  it("сливает кадры короче минимума со следующим вместо цепочки миганий (Critical 1)", () => {
    // Единственная щель трека (0.5, 0.7) слишком далека (1.4 с) от желаемой
    // границы второго кадра (2.0 с) — окно поиска (1.0 с) её не находит, и
    // граница остаётся на месте, рвущей слово «b». Старый алгоритм без окна
    // тянул ОБЕ соседние границы к этой же единственной щели и схлопывал
    // средний кадр в 33 мс; новый — сливает его со следующим.
    const sparseWords = [
      { text: "a", startSec: 0, endSec: 0.5, matched: true },
      { text: "b", startSec: 0.7, endSec: 5.0, matched: true },
    ]
    const ctx = {
      plan: { shots: [
        { ...base, order: 0, startSec: 0, endSec: 1.0 },
        { ...base, order: 1, startSec: 1.0, endSec: 2.0 },
        { ...base, order: 2, startSec: 2.0, endSec: 5.0 },
      ] },
      trackDurationSec: 5.0,
      fps: 30,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 5.0, words: sparseWords }],
      profile: DEFAULT_EDIT_PROFILE,
      lipSyncMaxDurationSec: 10,
      minGenerativeVideoSec: 5,
      knownBackgroundIds: new Set<string>(),
    } as never

    const { plan, remaining } = repairShotPlan(ctx)

    expect(plan.shots.length).toBe(2)
    for (const s of plan.shots) expect(s.endSec - s.startSec).toBeGreaterThanOrEqual(MIN_SHOT_SEC)
    expect(plan.shots[0]!.startSec).toBeCloseTo(0, 6)
    expect(plan.shots[0]!.endSec).toBeCloseTo(2.0, 6)
    expect(plan.shots[1]!.endSec).toBeCloseTo(5.0, 6)

    // Единственный оставшийся word_split — на границе 2.0, которую окно не
    // смогло дотянуть до щели. Раньше цепочка тянущихся друг к другу границ
    // давала 23 таких нарушения вместо одного.
    expect(remaining.filter(v => v.code === "word_split").length).toBe(1)
  })

  it("тишина до первого и после последнего слова тоже считается щелью (Important 4)", () => {
    // Единственное слово (1.4-2.3), поэтому пар «конец слова — начало
    // следующего» нет вовсе: без учёта тишины по краям щелей не нашлось бы,
    // и граница 1.8 осталась бы рвущей слово. С учётом краевой тишины
    // ближайшая (в пределах окна) щель — хвостовая (2.3, 3.0), середина 2.65.
    const ctx = {
      plan: { shots: [
        { ...base, order: 0, startSec: 0, endSec: 1.8 },
        { ...base, order: 1, startSec: 1.8, endSec: 3.0 },
      ] },
      trackDurationSec: 3.0,
      fps: 30,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 3.0, words: [{ text: "слово", startSec: 1.4, endSec: 2.3, matched: true }] }],
      profile: DEFAULT_EDIT_PROFILE,
      lipSyncMaxDurationSec: 10,
      minGenerativeVideoSec: 5,
      knownBackgroundIds: new Set<string>(),
    } as never

    const { plan, remaining } = repairShotPlan(ctx)

    expect(plan.shots[0]!.endSec).toBeCloseTo(80 / 30, 6)
    expect(remaining.map(v => v.code)).not.toContain("word_split")
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

  it("прижимает конец последнего кадра к trackEndFrame, а не к округлению вверх (Critical 2)", () => {
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

  it("план, восстановленный на некратной кадру длительности трека, проходит валидацию (Critical 2)", () => {
    // Прямая репликация сценария ревью: repair ставит конец последнего кадра
    // в trackEndFrame(3.02, 30) = 3.0, а старая валидация сверяла хвост с
    // сырыми 3.02 и объявляла дыру 3.00-3.02 там, где реального звука уже нет.
    const { remaining } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.4 },
      { ...base, order: 1, startSec: 1.6, endSec: 2.8 },
    ], { trackDurationSec: 3.02 }))

    expect(remaining.map(v => v.code)).not.toContain("gap")
    expect(remaining.map(v => v.code)).not.toContain("out_of_track")
  })

  it("чинит кадр с нечисловой границей от модели, не протаскивая NaN в план (Critical 3)", () => {
    const { plan, remaining } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: Number.NaN },
      { ...base, order: 1, startSec: 1.9, endSec: 3.0 },
    ]))

    for (const s of plan.shots) {
      expect(Number.isFinite(s.startSec)).toBe(true)
      expect(Number.isFinite(s.endSec)).toBe(true)
      expect(s.endSec).toBeGreaterThan(s.startSec)
    }
    expect(remaining.map(v => v.code)).not.toContain("invalid_bounds")
  })

  it("деградирует генеративное видео на коротком кадре до картинки", () => {
    // §10: такая заявка отклоняется валидацией ДО оплаты, а кадр идёт
    // картинкой с движением. Флаг профиля включён явно, чтобы тест проверял
    // именно короткую длительность, а не заодно и Minor 6 (см. отдельный тест).
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 2.0, background: "video" },
      { ...base, order: 1, startSec: 2.0, endSec: 3.0 },
    ], { profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true } }))

    expect(plan.shots[0]!.background).toBe("image")
  })

  it("не трогает генеративное видео на кадре достаточной длины при включённом флаге", () => {
    // Зеркало предыдущего теста: минимум опущен до 1 с, кадр длится 2 с —
    // «video» не должен деградировать сам по себе, только относительно порога
    // ИЛИ выключенного флага (см. следующий тест).
    const { plan } = repairShotPlan(context(
      [{ ...base, order: 0, startSec: 0, endSec: 2.0, background: "video" }],
      {
        trackDurationSec: 2.0,
        minGenerativeVideoSec: 1,
        profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true },
      },
    ))

    expect(plan.shots[0]!.background).toBe("video")
  })

  it("деградирует генеративное видео, когда флаг профиля выключен, даже при достаточной длине (Minor 6)", () => {
    // §7: «только... по флагу профиля». DEFAULT_EDIT_PROFILE.generativeVideoEnabled
    // === false — репэйр обязан деградировать кадр, даже если длина в порядке.
    const { plan } = repairShotPlan(context(
      [{ ...base, order: 0, startSec: 0, endSec: 3.0, background: "video" }],
      { minGenerativeVideoSec: 1 },
    ))

    expect(plan.shots[0]!.background).toBe("image")
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

  it("сбрасывает app_screen без ссылки на источник в картинку (Minor 5)", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, background: "app_screen", appReferenceId: null },
    ]))

    expect(plan.shots[0]!.background).toBe("image")
  })

  it("после ремонта план проходит проверку покрытия", () => {
    const { remaining } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.4 },
      { ...base, order: 1, startSec: 1.6, endSec: 2.8 },
    ]))

    const codes = remaining.map(v => v.code)
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

  it("before содержит найденные нарушения, remaining подтверждает, что дыра действительно закрыта (Important 3)", () => {
    // Название и докстринг брифа для старого поля `repaired` утверждали «то,
    // что почищено», а на деле это было `before` — нарушения ДО ремонта.
    // `remaining` — честный повторный прогон валидации ПОСЛЕ.
    const { before, remaining } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.0 },
      { ...base, order: 1, startSec: 1.5, endSec: 3.0 },
    ]))

    expect(before.map(v => v.code)).toContain("gap")
    expect(remaining.map(v => v.code)).not.toContain("gap")
  })

  it("remaining честно отражает то, что ремонт сознательно не чинит (Important 3)", () => {
    // presenter_too_long (дробление реплики — Task 4) и broll_ratio (доля —
    // вопрос смысла, а не геометрии) не трогаются репэйром вообще. Старое
    // поле `repaired` совпадало бы с `before` буквально и для этих кодов
    // тоже создавало бы видимость «зафиксировано», хотя ничего не менялось.
    const { before, remaining } = repairShotPlan(context(
      [{ ...base, order: 0, foreground: "presenter", startSec: 0, endSec: 3.0 }],
      { lipSyncMaxDurationSec: 1 },
    ))

    expect(before.map(v => v.code)).toContain("presenter_too_long")
    expect(before.map(v => v.code)).toContain("broll_ratio")
    expect(remaining.map(v => v.code)).toContain("presenter_too_long")
    expect(remaining.map(v => v.code)).toContain("broll_ratio")
  })

  it("не падает на пустом плане и сообщает о нём в before и remaining", () => {
    const { plan, before, remaining } = repairShotPlan(context([]))

    expect(plan.shots).toEqual([])
    expect(before.map(v => v.code)).toContain("empty")
    expect(remaining.map(v => v.code)).toContain("empty")
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
