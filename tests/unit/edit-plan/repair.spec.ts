import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import { minShotSec, repairShotPlan, safePointWindowSec } from "~~/server/utils/edit-plan/repair"
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
    for (const s of plan.shots) expect(s.endSec - s.startSec).toBeGreaterThanOrEqual(minShotSec(DEFAULT_EDIT_PROFILE))
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
    // и граница 1.8 осталась бы рвущей слово. С учётом краевой тишины есть
    // две щели-кандидата: ведущая (0, 1.4) и хвостовая (2.3, 3.0). Расстояние
    // меряется до БЛИЖНЕГО безопасного края щели (Important Н-4 ре-ревью), а
    // не до середины: до ведущей — 0.43 с (её ближний край 1.3667), до
    // хвостовой — 0.53 с (её ближний край 2.3333). Ведущая ближе и побеждает.
    // Старый алгоритм мерял до середины (0.7 и 1.1 соответственно) и выбирал
    // ХВОСТОВУЮ — уводя границу на +0.87 вперёд вместо −0.43 назад.
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

    expect(plan.shots[0]!.endSec).toBeCloseTo(41 / 30, 6)
    expect(remaining.map(v => v.code)).not.toContain("word_split")
  })

  it("выбирает ближний край широкой щели, а не её середину (Important Н-4)", () => {
    const ctx = {
      plan: { shots: [
        { ...base, order: 0, startSec: 0, endSec: 4.0 },
        { ...base, order: 1, startSec: 4.0, endSec: 10.0 },
      ] },
      trackDurationSec: 10.0,
      fps: 30,
      alignedScenes: [{
        order: 1,
        startSec: 0,
        endSec: 10.0,
        words: [
          { text: "a", startSec: 0, endSec: 4.5, matched: true },
          { text: "b", startSec: 6.9, endSec: 10.0, matched: true },
        ],
      }],
      profile: DEFAULT_EDIT_PROFILE,
      lipSyncMaxDurationSec: 10,
      minGenerativeVideoSec: 5,
      knownBackgroundIds: new Set<string>(),
    } as never

    const { plan, remaining } = repairShotPlan(ctx)

    // Щель (4.5, 6.9): ближний безопасный рез ~4.53 — в пределах окна
    // (при дефолтном шаге 1.8 с окно 0.54 с). Середина щели (5.7) — в 1.7 с
    // от желаемой границы 4.0, вне окна. Старый алгоритм мерял до середины и
    // отвергал эту щель целиком, оставляя word_split неисправленным.
    expect(plan.shots[0]!.endSec).toBeGreaterThanOrEqual(4.5)
    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(4.6)
    expect(remaining.map(v => v.code)).not.toContain("word_split")
  })

  it("не выбирает щель, лежащую внутри слова при перекрывающихся словах (Minor Н-9)", () => {
    const ctx = {
      plan: { shots: [
        { ...base, order: 0, startSec: 0, endSec: 3.5 },
        { ...base, order: 1, startSec: 3.5, endSec: 9.0 },
      ] },
      trackDurationSec: 9.0,
      fps: 30,
      alignedScenes: [{
        order: 1,
        startSec: 0,
        endSec: 9.0,
        words: [
          { text: "длинное", startSec: 0, endSec: 5.0, matched: true },
          { text: "вложенное", startSec: 1.0, endSec: 1.5, matched: true },
          { text: "третье", startSec: 6.0, endSec: 9.0, matched: true },
        ],
      }],
      profile: DEFAULT_EDIT_PROFILE,
      lipSyncMaxDurationSec: 10,
      minGenerativeVideoSec: 5,
      knownBackgroundIds: new Set<string>(),
    } as never

    const { plan, remaining } = repairShotPlan(ctx)

    // «Щель» между вложенным и третьим словом (1.5, 6.0) на деле лежит
    // ВНУТРИ слова «длинное» (0-5.0) на отрезке 1.5-5.0. Без перепроверки
    // выбранной точки repair «починил» бы границу 3.5 в середину этой мнимой
    // щели (тоже внутри «длинное») и сам создал бы word_split там, где его
    // не было бы при честном отказе. Граница остаётся на месте.
    expect(plan.shots[0]!.endSec).toBeCloseTo(3.5, 6)
    expect(remaining.map(v => v.code)).toContain("word_split")
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

  it("клэмпит внутреннюю границу к timelineEnd, а не к сырой длительности трека (Critical Н-2)", () => {
    // Прямая репликация сценария ре-ревью: слово a(0-2.5), трек 3.02 с (не
    // кратен кадру), план с кадром, вылезающим далеко за трек. Клэмп сырой
    // `trackDurationSec` (3.02) пропускал желаемую точку 3.02 дальше в
    // `snapSecToFrame`, который округляет к БЛИЖАЙШЕМУ кадру (3.0333) — выше
    // настоящего конца таймлайна (3.0). Второй кадр после этого имел длину
    // 3.0 − 3.0333 = −0.0333 с. Клэмп к timelineEnd этого не допускает.
    const ctx = {
      plan: { shots: [
        { ...base, order: 0, startSec: 0, endSec: 4.0 },
        { ...base, order: 1, startSec: 4.0, endSec: 5.0 },
      ] },
      trackDurationSec: 3.02,
      fps: 30,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 3.02, words: [{ text: "a", startSec: 0, endSec: 2.5, matched: true }] }],
      profile: DEFAULT_EDIT_PROFILE,
      lipSyncMaxDurationSec: 10,
      minGenerativeVideoSec: 5,
      knownBackgroundIds: new Set<string>(),
    } as never

    const { plan, remaining } = repairShotPlan(ctx)

    for (const s of plan.shots) expect(s.endSec).toBeGreaterThan(s.startSec)
    const codes = remaining.map(v => v.code)
    expect(codes).not.toContain("invalid_bounds")
    expect(codes).not.toContain("out_of_track")
    expect(codes).not.toContain("gap")
  })

  it("сливает короткий хвост назад, в предыдущий кадр (Critical Н-3)", () => {
    // Хвост исключался из слияния явным `!isLast` — финальный кадр 0.4 с
    // (например, под логотип) проходил валидацию чистым и получал
    // оплаченный фон. Теперь хвост сливается НАЗАД: вперёд для него нет
    // цели, а назад — есть.
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 9.6 },
      { ...base, order: 1, startSec: 9.6, endSec: 10.0, idea: "логотип" },
    ], { trackDurationSec: 10.0 }))

    expect(plan.shots.length).toBe(1)
    expect(plan.shots[0]!.endSec).toBeCloseTo(10.0, 6)
  })

  it("не растягивает presenter-кадр за потолок lip-sync слиянием (Critical Н-1)", () => {
    // Прямая репликация сценария ре-ревью: дыра 0.05 с (0.50-0.55) — самое
    // обычное нарушение, которое ремонт должен уметь чинить. Но слить
    // 0.5-секундный кадр-хук со следующим presenter-кадром (9.85 с) значило
    // бы получить 10.4 с при потолке kling-lip-sync 10 с — нарушение, которое
    // ремонт НЕ умеет чинить сам (дробление реплики — отдельный шаг Task 4).
    // Слияние обязано отказаться и оставить короткий кадр как есть.
    const words = [
      { text: "x", startSec: 0, endSec: 0.4, matched: true },
      { text: "y", startSec: 0.6, endSec: 10.3, matched: true },
      { text: "z", startSec: 10.5, endSec: 15.5, matched: true },
    ]
    const ctx = {
      plan: { shots: [
        { ...base, order: 0, startSec: 0, endSec: 0.5, foreground: "presenter", idea: "хук", sceneOrder: 1 },
        { ...base, order: 1, startSec: 0.55, endSec: 10.4, foreground: "presenter", idea: "тезис", sceneOrder: 2 },
        { ...base, order: 2, startSec: 10.4, endSec: 16, foreground: "none", sceneOrder: 3 },
      ] },
      trackDurationSec: 16,
      fps: 30,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 16, words }],
      profile: DEFAULT_EDIT_PROFILE,
      lipSyncMaxDurationSec: 10,
      minGenerativeVideoSec: 5,
      knownBackgroundIds: new Set<string>(),
    } as never

    const { plan, remaining } = repairShotPlan(ctx)

    expect(remaining.map(v => v.code)).not.toContain("presenter_too_long")
    for (const s of plan.shots) {
      if (s.foreground === "presenter") expect(s.endSec - s.startSec).toBeLessThanOrEqual(10 + 1e-6)
    }
  })

  it("разгружает presenter-кадр на краю трека в пользу не-presenter соседа (Critical Н-1, найдено тестом-свойством)", () => {
    // Кадр модели [3, 3.1] presenter — совершенно обычный короткий кадр, не
    // вырожденный и не выходящий за трек. Но последний кадр по построению
    // ОБЯЗАН дотягиваться до конца таймлайна (Critical 2/3) — и без разгрузки
    // молча наследует ВСЮ дыру 3.1-10 (6.9 с) при потолке lip-sync 3 с. Это
    // не проходит через слияние коротких кадров вовсе: кадр к этому моменту
    // уже длинный (растянут), а не короткий. Сосед — presenter[0,3] — НЕ
    // presenter, поэтому разгрузка возможна: общая граница уходит туда, где
    // presenter-кадр укладывается точно в потолок.
    const { plan, remaining } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 3, foreground: "none" },
      { ...base, order: 1, startSec: 3, endSec: 3.1, foreground: "presenter" },
    ], { trackDurationSec: 10, lipSyncMaxDurationSec: 3 }))

    expect(remaining.map(v => v.code)).not.toContain("presenter_too_long")
    expect(plan.shots[1]!.endSec - plan.shots[1]!.startSec).toBeLessThanOrEqual(3 + 1e-6)
  })

  it("не может разгрузить presenter-кадр, если сосед тоже presenter — суммарная длина шире двух потолков (документированное ограничение)", () => {
    // Оба кадра presenter, суммарно должны покрыть 10 с при потолке 3 с на
    // кадр — 2 кадра под потолком дают максимум 6 с, а нужно 10. Раздвинуть
    // общую границу некуда: любой сдвиг переносит избыток на ДРУГОЙ
    // presenter-кадр, а не устраняет его. Дробление реплики на достаточное
    // число кадров — работа `splitLongPresenterLine` (Task 4, §5.3),
    // вызываемая ДО этой функции; сама по себе арифметика границ здесь
    // бессильна, и `remaining` честно сообщает об этом.
    const { remaining } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 3, foreground: "presenter" },
      { ...base, order: 1, startSec: 3, endSec: 3.1, foreground: "presenter" },
    ], { trackDurationSec: 10, lipSyncMaxDurationSec: 3 }))

    expect(remaining.map(v => v.code)).toContain("presenter_too_long")
  })

  it("разгружает presenter-кадр, который сам оказался на краю в результате слияния (Critical Н-1, найдено тестом-свойством вне committed диапазона сидов)", () => {
    // Вырожденный кадр 0 (0 с) обязан слиться со следующим (Critical Н-2/Н-3
    // приоритетнее мягкой защиты presenter — см. docstring canMergeSafely).
    // presenter-контент при этом впервые оказывается на самом КРАЮ таймлайна
    // только ПОСЛЕ слияния — до слияния он не был крайним, разгрузка перед
    // слиянием его не касалась. Без повторного вызова разгрузки ПОСЛЕ слияния
    // это нарушение осталось бы, будучи полностью устранимым (сосед — не
    // presenter). Нашлось тестом-свойством на seed=909 — за пределами
    // committed диапазона в 300 сценариев, поэтому закреплено отдельно.
    const { remaining } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 0, foreground: "none" },
      { ...base, order: 1, startSec: 0, endSec: 6, foreground: "presenter" },
      { ...base, order: 2, startSec: 6, endSec: 20, foreground: "none" },
    ], { trackDurationSec: 20, lipSyncMaxDurationSec: 5 }))

    expect(remaining.map(v => v.code)).not.toContain("presenter_too_long")
  })

  it("не съедает все presenter-кадры слиянием — потеря ведущего недопустима (Critical Н-1)", () => {
    // Шесть кадров по 0.6 с (короче любого разумного минимума), строго
    // чередующих presenter/перебивку. Слепое слияние «вперёд» съедает кадр
    // за кадром по чётности и на 20-кадровом варианте того же сценария
    // (ре-ревью) превращало долю перебивок 50% в 100%, не оставляя от
    // ведущего ни кадра. `broll_ratio` сам по себе не блокирует репэйр по
    // рулингу заказчика, но полное исчезновение ведущего — это не смещение
    // доли, а потеря контента, и именно это обязано быть предотвращено.
    const ctx = {
      plan: { shots: [
        { ...base, order: 0, startSec: 0, endSec: 0.6, foreground: "presenter" },
        { ...base, order: 1, startSec: 0.6, endSec: 1.2, foreground: "none" },
        { ...base, order: 2, startSec: 1.2, endSec: 1.8, foreground: "presenter" },
        { ...base, order: 3, startSec: 1.8, endSec: 2.4, foreground: "none" },
        { ...base, order: 4, startSec: 2.4, endSec: 3.0, foreground: "presenter" },
        { ...base, order: 5, startSec: 3.0, endSec: 3.6, foreground: "none" },
      ] },
      trackDurationSec: 3.6,
      fps: 30,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 3.6, words: [] }],
      profile: DEFAULT_EDIT_PROFILE,
      lipSyncMaxDurationSec: 10,
      minGenerativeVideoSec: 5,
      knownBackgroundIds: new Set<string>(),
    } as never

    const { plan } = repairShotPlan(ctx)

    expect(plan.shots.some(s => s.foreground === "presenter")).toBe(true)
  })

  it("минимальный шаг и окно поиска подстраиваются под легальную настройку профиля, не выкашивая план (Important Н-5)", () => {
    // Шаг профиля 0.8 с — легальный минимум по `profile.ts`. Раньше порог
    // слияния был фиксированной константой 0.8 с — при такой настройке пол
    // ремонта РАВНЯЛСЯ цели, и кадры по 0.6 с (разумные при таком шаге)
    // массово сливались. Порог теперь — доля от шага (0.4), то есть 0.32 с:
    // кадры по 0.6 с остаются нетронутыми.
    const ctx = {
      plan: { shots: [
        { ...base, order: 0, startSec: 0, endSec: 0.6 },
        { ...base, order: 1, startSec: 0.6, endSec: 1.2 },
        { ...base, order: 2, startSec: 1.2, endSec: 1.8 },
        { ...base, order: 3, startSec: 1.8, endSec: 2.4 },
      ] },
      trackDurationSec: 2.4,
      fps: 30,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 2.4, words: [] }],
      profile: { ...DEFAULT_EDIT_PROFILE, shotChangeSec: 0.8 },
      lipSyncMaxDurationSec: 10,
      minGenerativeVideoSec: 5,
      knownBackgroundIds: new Set<string>(),
    } as never

    const { plan } = repairShotPlan(ctx)

    expect(plan.shots.length).toBe(4)
  })

  it("окно поиска щели всегда заметно уже половины целевого шага монтажа (Important Н-5)", () => {
    // Раньше окно было константой 1.0 с — шире целого кадра при легальном
    // минимуме шага 0.8 с и 56% кадра при дефолтных 1.8 с.
    for (const shotChangeSec of [0.8, 1.8, 3.0]) {
      expect(safePointWindowSec({ ...DEFAULT_EDIT_PROFILE, shotChangeSec })).toBeLessThan(shotChangeSec / 2)
    }
  })

  it("changes сообщает о слиянии и о сбросе фона (Important Н-6)", () => {
    // Слияние выбрасывает метаданные съеденного кадра молча — библиотечная
    // перебивка (источник ценой 0 по §7) исчезала бы без единого следа.
    const { changes, plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 2.7, background: "library", backgroundClipId: "нет-такого" },
      { ...base, order: 1, startSec: 2.7, endSec: 3.0 },
    ]))

    expect(plan.shots.length).toBe(1)
    expect(changes.some(c => c.message.includes("слит"))).toBe(true)
    expect(changes.some(c => c.message.includes("фон"))).toBe(true)
  })

  it("changes сообщает о деградации генеративного видео (Important Н-6)", () => {
    const { changes } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 2.0, background: "video" },
      { ...base, order: 1, startSec: 2.0, endSec: 3.0 },
    ], { profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true } }))

    expect(changes.some(c => c.message.includes("видео"))).toBe(true)
  })

  it("считает допуски по fps контекста, а не только по 30 (Important Н-7)", () => {
    const { remaining } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.4 },
      { ...base, order: 1, startSec: 1.4, endSec: 3.0 },
    ], { fps: 24 }))

    expect(remaining.map(v => v.code)).not.toContain("word_split")
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
