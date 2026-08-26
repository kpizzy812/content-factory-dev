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

  // ── Группировка фонов (правка 26.08.2026, дефект «фон меняется каждые
  //    1.8 с» — см. background-reuse-report.md). `reuseFrom` — та же
  //    группировка, что уже держит непрерывное движение камеры
  //    (shot-variation.ts), проверяется здесь только КАК ОНА ПРИМЕНЕНА к
  //    планированию фонов, а не переизобретается.
  describe("группировка фонов (reuseFrom)", () => {
    /** Пять подряд идущих кадров по 1.8с — реальный шаг монтажа (§7). */
    function contiguous(count: number, over: (i: number) => Partial<PlannedShotRow> = () => ({})): PlannedShotRow[] {
      return Array.from({ length: count }, (_, i) => shot({
        order: i, startSec: i * 1.8, endSec: (i + 1) * 1.8, ...over(i),
      }))
    }

    it("пять подряд идущих кадров с одной idea — один лидер (reuseFrom: null), четверо указывают на него", () => {
      const plan = planShotBackgroundExecution({ ...LIMITS, shots: contiguous(5) })
      expect(plan.items[0]!.reuseFrom).toBeNull()
      for (let i = 1; i < 5; i += 1) expect(plan.items[i]!.reuseFrom).toBe(0)
      // Промпт просит ТОЛЬКО лидер — требование «одна генерация на группу»
      // начинается уже здесь: агент промптов не тратит токены на клонов.
      expect(plan.promptOrders).toEqual([0])
    })

    it("смена idea у ОДНОГО кадра разрывает группу — до и после смены получают своих лидеров", () => {
      const shots = contiguous(5)
      shots[2] = { ...shots[2]!, idea: "другая идея" }
      const plan = planShotBackgroundExecution({ ...LIMITS, shots })

      // Кадр 2 — сам себе лидер (идея другая).
      expect(plan.items[2]!.reuseFrom).toBeNull()
      // Кадры 0-1 остались группой со СВОИМ лидером (0), кадр 2 их не задел.
      expect(plan.items[0]!.reuseFrom).toBeNull()
      expect(plan.items[1]!.reuseFrom).toBe(0)
      // Кадры 3-4 образуют НОВУЮ группу (старая идея вернулась после разрыва),
      // лидер — 3, а НЕ 0: смежность с кадром 0 разорвана кадром 2.
      expect(plan.items[3]!.reuseFrom).toBeNull()
      expect(plan.items[4]!.reuseFrom).toBe(3)
      expect(plan.promptOrders).toEqual([0, 2, 3])
    })

    it("две НЕсоседние группы с одинаковой idea — у каждой свой лидер, генерации не сливаются", () => {
      // Кадры 0-1 идея "A", кадр 2 идея "B" (разрывает смежность), кадры 3-4
      // снова идея "A" — решение: переиспользуется ТА ЖЕ группировка, что и у
      // движения камеры, а она не сливает несмежные группы (см.
      // shot-variation.spec.ts, «разрыв во времени рвёт группу»). Слияние
      // через ВЕСЬ ролик потребовало бы отдельного, не заказанного этой
      // правкой глобального кэша «idea -> файл».
      const shots = [
        shot({ order: 0, startSec: 0, endSec: 1.8, idea: "A" }),
        shot({ order: 1, startSec: 1.8, endSec: 3.6, idea: "A" }),
        shot({ order: 2, startSec: 3.6, endSec: 5.4, idea: "B" }),
        shot({ order: 3, startSec: 5.4, endSec: 7.2, idea: "A" }),
        shot({ order: 4, startSec: 7.2, endSec: 9.0, idea: "A" }),
      ]
      const plan = planShotBackgroundExecution({ ...LIMITS, shots })
      expect(plan.items[0]!.reuseFrom).toBeNull()
      expect(plan.items[1]!.reuseFrom).toBe(0)
      expect(plan.items[2]!.reuseFrom).toBeNull()
      expect(plan.items[3]!.reuseFrom).toBeNull() // НЕ 0 — несмежная группа, свой лидер
      expect(plan.items[4]!.reuseFrom).toBe(3)
      expect(plan.promptOrders).toEqual([0, 2, 3])
    })

    it("разрыв во времени (кадры не встык) рвёт группу, даже если idea та же", () => {
      const shots = [
        shot({ order: 0, startSec: 0, endSec: 1.8, idea: "A" }),
        shot({ order: 1, startSec: 5.0, endSec: 6.8, idea: "A" }), // дыра в таймлайне
      ]
      const plan = planShotBackgroundExecution({ ...LIMITS, shots })
      expect(plan.items[0]!.reuseFrom).toBeNull()
      expect(plan.items[1]!.reuseFrom).toBeNull()
    })

    it("генеративное видео НИКОГДА не группируется — даже подряд, с одной idea", () => {
      // Требование 1 брифа перечисляет только image/library/app_screen;
      // видео исключено явно (docstring reuseFrom): длина заказа Kling
      // реально зависит от длины КАЖДОГО кадра.
      const shots = [
        shot({ order: 0, startSec: 0, endSec: 5, idea: "полёт дрона", background: "video" }),
        shot({ order: 1, startSec: 5, endSec: 10, idea: "полёт дрона", background: "video" }),
      ]
      const plan = planShotBackgroundExecution({ ...LIMITS, shots })
      expect(plan.items[0]!.reuseFrom).toBeNull()
      expect(plan.items[1]!.reuseFrom).toBeNull()
    })

    it("библиотека и скрин приложения группируются по id, а не по idea", () => {
      const shots = [
        shot({ order: 0, startSec: 0, endSec: 1.8, background: "library", backgroundClipId: "bg1", idea: null }),
        shot({ order: 1, startSec: 1.8, endSec: 3.6, background: "library", backgroundClipId: "bg1", idea: "не важно, разные идеи" }),
      ]
      const plan = planShotBackgroundExecution({ ...LIMITS, shots })
      expect(plan.items[0]!.reuseFrom).toBeNull()
      expect(plan.items[1]!.reuseFrom).toBe(0)
    })
  })
})
