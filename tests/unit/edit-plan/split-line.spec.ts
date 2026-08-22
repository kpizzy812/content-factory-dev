import { describe, expect, it } from "vitest"

import { ensuresAdvance, splitLongPresenterLine } from "~~/server/utils/edit-plan/split-line"

function scene(words: Array<[string, number, number]>, order = 1) {
  return {
    order,
    startSec: words[0]![1],
    endSec: words[words.length - 1]![2],
    words: words.map(([text, startSec, endSec]) => ({ text, startSec, endSec, matched: true })),
  }
}

describe("дробление реплики длиннее потолка модели", () => {
  it("не трогает реплику, которая влезает в потолок", () => {
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 1], ["два", 1, 2]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([{ startSec: 0, endSec: 2 }])
    expect(result.interludes).toEqual([])
    expect(result.warning).toBeNull()
  })

  it("режет по самой длинной паузе внутри реплики", () => {
    // §5.3 п.1: там смена плана выглядит намеренной.
    const result = splitLongPresenterLine({
      scene: scene([
        ["раз", 0, 3], ["два", 3.2, 6],
        ["три", 8, 11], ["четыре", 11.2, 13],
      ]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: false,
    })

    expect(result.parts).toHaveLength(2)
    // Пауза 6.0-8.0 — самая длинная, рез идёт в неё.
    expect(result.parts[0]!.endSec).toBeGreaterThanOrEqual(6)
    expect(result.parts[0]!.endSec).toBeLessThanOrEqual(8)
    expect(result.warning).toBeNull()
  })

  it("из двух значимых пауз выбирает именно самую длинную, а не любую значимую", () => {
    // Мутация: ловит инверсию сортировки в выборе branch 1 (взять КОРОТКУЮ
    // значимую паузу вместо ДЛИННОЙ). Пауза (2, 2.6) значима (0.6с), но пауза
    // (4, 6) значима И длиннее (2.0с) — рез обязан уйти именно во вторую.
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 2], ["б", 2.6, 4], ["в", 6, 9], ["г", 9.2, 15]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts[0]!.endSec).toBeGreaterThanOrEqual(4)
    expect(result.parts[0]!.endSec).toBeLessThanOrEqual(6)
    expect(result.warning).toBeNull()
  })

  it("ставит между частями перебивку, если пауза не годится", () => {
    // §5.3 п.2: тогда склейка двух ракурсов ведущего вообще не встречается.
    const result = splitLongPresenterLine({
      scene: scene([
        ["раз", 0, 5.9], ["два", 5.95, 11.8],
      ]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts.length).toBeGreaterThanOrEqual(2)
    expect(result.interludes.length).toBeGreaterThanOrEqual(1)
  })

  it("режет по межсловному интервалу с WARN, когда перебивка запрещена", () => {
    // §5.3 п.3: и только если запрещено и это.
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 5.9], ["два", 5.95, 11.8]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: false,
    })

    expect(result.parts.length).toBeGreaterThanOrEqual(2)
    expect(result.interludes).toEqual([])
    expect(result.warning).toMatch(/WARN/)
  })

  it("ни одна часть не длиннее потолка модели", () => {
    const result = splitLongPresenterLine({
      scene: scene([
        ["а", 0, 8], ["б", 8.1, 16], ["в", 16.1, 24],
      ]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    for (const part of result.parts) {
      expect(part.endSec - part.startSec).toBeLessThanOrEqual(10 + 1e-6)
    }
  })

  it("части и перебивки покрывают реплику без дыр", () => {
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 6], ["б", 8, 14]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    const covered = [...result.parts, ...result.interludes].sort((a, b) => a.startSec - b.startSec)
    expect(covered[0]!.startSec).toBeCloseTo(0, 3)
    expect(covered[covered.length - 1]!.endSec).toBeCloseTo(14, 3)
    for (let i = 1; i < covered.length; i += 1) {
      expect(covered[i]!.startSec).toBeCloseTo(covered[i - 1]!.endSec, 3)
    }
  })

  it("реплика ровно в потолок не режется (граница включительно)", () => {
    // Мутация: ловит замену "<=" на "<" в проверке "влезает ли реплика целиком".
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 5], ["два", 5, 10]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([{ startSec: 0, endSec: 10 }])
    expect(result.warning).toBeNull()
  })

  it("узкая пауза у самого начала не даёт вырожденную перебивку и не даёт строб — падает в branch 4", () => {
    // Ре-ревью И-1: пауза [0.008, 0.3] после притяжки к кадру (fps=30) снапает
    // начало К cursor'у (0.008 -> 0) — branch 2 отклоняет по "from > cursor".
    // branch 3 нашёл бы тот же интервал и дал бы часть [0, 0.1667] — она
    // ПОЛОЖИТЕЛЬНОЙ длины и НЕ вырождена геометрически, но короче
    // MIN_MEANINGFUL_PART_SEC (0.35с) — строб, а не монтажный рез. Прежняя
    // версия (без проверки минимальной осмысленной части) приняла бы её:
    // без проверки ниже эта же пара assert'ов проходила бы и на 0.1667.
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 0.008], ["два", 0.3, 15]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.interludes).toEqual([])
    // Именно 10, а не 0.1667 — доказывает, что короткий branch-3 кандидат был
    // отвергнут проверкой минимальной части, а не просто "как-то" отклонён.
    expect(result.parts[0]).toEqual({ startSec: 0, endSec: 10 })
    expect(result.warning).toMatch(/WARN/)
  })

  it("технически значимая по длительности пауза всё равно отклоняется, если часть до неё — строб", () => {
    // И-1: пауза [0.1, 0.5] длиной 0.4с >= MEANINGFUL_PAUSE_SEC (0.35), branch 1
    // формально имеет право её взять — но её середина (0.3с) даёт часть
    // [0, 0.3] короче MIN_MEANINGFUL_PART_SEC. "Значимая пауза" и "осмысленная
    // часть" — разные условия, оба обязаны выполняться одновременно.
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 0.1], ["два", 0.5, 20]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: false,
    })

    expect(result.parts[0]).toEqual({ startSec: 0, endSec: 10 })
    expect(result.warning).toMatch(/WARN/)
  })

  it("реплика без слов не даёт частей — резать нечего", () => {
    const result = splitLongPresenterLine({
      scene: { order: 1, startSec: 0, endSec: 0, words: [] },
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([])
  })
})

describe("И-1 (ре-ревью): допуск на шум плавающей точки в гарантии продвижения", () => {
  it("законный однокадровый рез не отвергается из-за представления двоичной дроби", () => {
    // Пример ре-ревью буквально: fps=24, cursor=7/24, candidate=8/24 (ровно
    // один кадр вперёд). cursor + 1/24, посчитанный сложением, оказывается
    // 0.33333333333333337 — строго больше candidate (0.3333333333333333) —
    // и без допуска легальное продвижение на кадр отвергается.
    const cursor = 7 / 24
    const candidate = 8 / 24
    expect(cursor + 1 / 24).toBeGreaterThan(candidate) // подтверждаем сам артефакт
    expect(ensuresAdvance(cursor, candidate, 24)).toBe(true)
  })

  it("настоящая недостача (меньше кадра) по-прежнему отвергается — допуск не маскирует реальный дефицит", () => {
    expect(ensuresAdvance(0, 0.5 / 24, 24)).toBe(false)
  })
})

describe("И-2 (ре-ревью): ветки 1 и 2 перебирают всех кандидатов, а не только первого", () => {
  it("branch 1: провал у самой длинной паузы не мешает взять следующую по длине", () => {
    // Вход ре-ревью: fps=1, max=2. Пауза A=[0.1,0.7] (0.6с, самая длинная,
    // середина 0.4 снапается в 0 => провал продвижения). Пауза B=[1.4,1.9]
    // (0.5с, тоже значимая, середина 1.65 снапается в 2 => продвигает). Без
    // перебора управление уходило в branch 3/4 с лишним WARN, хотя B годилась.
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 0.1], ["б", 0.7, 1.4], ["в", 1.9, 3.2]]),
      maxDurationSec: 2,
      fps: 1,
      brollAllowed: false,
    })

    expect(result.warning).toBeNull()
    // fps=1 снапает конец сцены (3.2) до 3 — ожидание сверено с реальным
    // округлением, а не подогнано под удобное число.
    expect(result.parts).toEqual([{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 3 }])
  })

  it("branch 2: провал у самой широкой паузы не мешает взять следующую по ширине", () => {
    // Вход ре-ревью: fps=30, max=10, brollAllowed=true. Пауза [0.008,0.3]
    // (0.292с, самая широкая) снапает начало в cursor (from=0) — отклонена.
    // Пауза [3.0,3.2] (0.2с, уже) — from=3.0, валидна. Правильный результат:
    // часть [0,3.0] + перебивка [3.0,3.2] БЕЗ WARN, а не рез по потолку.
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 0.008], ["б", 0.3, 3.0], ["в", 3.2, 13.0]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.warning).toBeNull()
    expect(result.parts[0]).toEqual({ startSec: 0, endSec: 3.0 })
    expect(result.interludes).toEqual([{ startSec: 3.0, endSec: 3.2 }])
  })
})

describe("И-3 (ре-ревью): невалидный потолок не зависает", () => {
  it("maxDurationSec = 0 — реплика не дробится, а отдаётся целиком с WARN", () => {
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 1], ["б", 1, 2]]),
      maxDurationSec: 0,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([{ startSec: 0, endSec: 2 }])
    expect(result.interludes).toEqual([])
    expect(result.warning).toMatch(/WARN/)
  })

  it("отрицательный maxDurationSec — тот же безопасный исход, без движения курсора назад", () => {
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 1], ["б", 1, 2]]),
      maxDurationSec: -5,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([{ startSec: 0, endSec: 2 }])
    expect(result.warning).toMatch(/WARN/)
  })

  it("NaN maxDurationSec — тот же безопасный исход", () => {
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 1], ["б", 1, 2]]),
      maxDurationSec: Number.NaN,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([{ startSec: 0, endSec: 2 }])
    expect(result.warning).toMatch(/WARN/)
  })

  it("крошечный положительный потолок (уже кадра) не зависает и покрывает реплику до конца", () => {
    // maxDurationSec=0.01 при fps=30 (кадр ~0.0333с) — потолок УЖЕ одного
    // кадра. branch 4 гарантирует продвижение минимум на кадр ценой выхода
    // части за (уже вырожденный) потолок — альтернатива хуже: цикл не кончится.
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 1], ["б", 1, 2]]),
      maxDurationSec: 0.01,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts.length).toBeGreaterThan(0)
    const covered = [...result.parts, ...result.interludes].sort((a, b) => a.startSec - b.startSec)
    expect(covered[0]!.startSec).toBeCloseTo(0, 6)
    expect(covered[covered.length - 1]!.endSec).toBeCloseTo(2, 6)
    for (let i = 1; i < covered.length; i += 1) {
      expect(covered[i]!.startSec).toBeCloseTo(covered[i - 1]!.endSec, 6)
    }
  })
})

describe("И-4 (ре-ревью): рез по потолку не уезжает выше maxDurationSec на некратном fps", () => {
  it("fps=29.97 (NTSC) — ни одна часть не длиннее потолка", () => {
    // До фикса: snapSecToFrame(10, 29.97) = 10.01001 — часть на 10мс длиннее
    // потолка lip-sync, провайдер отбил бы заказ после оплаты подготовки.
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 12], ["б", 12, 25]]), // слова встык — гарантированно идёт в branch 4
      maxDurationSec: 10,
      fps: 29.97,
      brollAllowed: true,
    })

    for (const part of result.parts) {
      expect(part.endSec - part.startSec).toBeLessThanOrEqual(10 + 1e-9)
    }
  })

  it("fps=23.976, maxDurationSec=8 — тот же инвариант на другой паре", () => {
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 10], ["б", 10, 20]]),
      maxDurationSec: 8,
      fps: 23.976,
      brollAllowed: true,
    })

    for (const part of result.parts) {
      expect(part.endSec - part.startSec).toBeLessThanOrEqual(8 + 1e-9)
    }
  })
})

describe("М-5 (ре-ревью): branch 3 при нескольких кандидатах выбирает ближайшего к потолку", () => {
  it("два валидных кандидата — побеждает более поздний (ближе к limit), а не более ранний", () => {
    const result = splitLongPresenterLine({
      scene: scene([
        ["а", 0, 3.0], ["б", 3.1, 6.9], ["в", 7.0, 15],
      ]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: false,
    })

    // Кандидаты branch 3 (обе паузы короче MEANINGFUL_PAUSE_SEC): [3.0,3.1] и
    // [6.9,7.0]. Обе дают осмысленную часть (>=0.35с). Побеждает [6.9,7.0] —
    // ближе к потолку 10с, а не [3.0,3.1], который стоял бы первым при
    // брифовом порядке "ближайший к курсору".
    expect(result.parts[0]!.endSec).toBeGreaterThanOrEqual(6.9)
    expect(result.parts[0]!.endSec).toBeLessThanOrEqual(7.0)
  })
})

describe("М-7 (ре-ревью): несколько WARN за одно дробление накапливаются, а не теряются", () => {
  it("два вынужденных реза по потолку — оба сообщения попадают в warning", () => {
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 12], ["б", 12, 35]]), // слова встык — оба реза идут через branch 4
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    const warnCount = (result.warning?.match(/WARN/g) ?? []).length
    expect(warnCount).toBeGreaterThanOrEqual(2)
  })
})

describe("М-14 (ре-ревью): негодный fps не ломает арифметику продвижения", () => {
  it("fps <= 0 — функция не падает и не зависает, использует фолбэк 1/60", () => {
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 12], ["б", 12, 25]]),
      maxDurationSec: 10,
      fps: 0,
      brollAllowed: true,
    })

    expect(result.parts.length).toBeGreaterThan(0)
    const covered = [...result.parts, ...result.interludes].sort((a, b) => a.startSec - b.startSec)
    expect(covered[0]!.startSec).toBeCloseTo(0, 6)
    expect(covered[covered.length - 1]!.endSec).toBeCloseTo(25, 6)
  })
})

describe("М-15 (ре-ревью): нечисловые границы сцены дают явный WARN, а не молчаливую пустоту", () => {
  it("NaN scene.startSec — warning заполнен, а не null", () => {
    const result = splitLongPresenterLine({
      scene: { order: 1, startSec: Number.NaN, endSec: 15, words: [{ text: "а", startSec: 0, endSec: 1, matched: true }] },
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([])
    expect(result.warning).toMatch(/WARN/)
  })
})

describe("поправка 2 — вырожденные паузы не зависают", () => {
  // Пауза [0.01, 0.015] стоит почти вплотную к началу реплики (cursor=0) и при
  // fps=30 (кадр ~0.033с) снапается ОБРАТНО к cursor и в середине (branch 1/3),
  // и по началу паузы (branch 2 — even после зажима снизу cursor'ом): без
  // гарантии продвижения из докстринга split-line.ts это зависало бы навсегда.
  const degenerateWords: Array<[string, number, number]> = [["раз", 0, 0.01], ["два", 0.015, 15]]

  it("с разрешённой перебивкой — режет по потолку и предупреждает", () => {
    const result = splitLongPresenterLine({
      scene: scene(degenerateWords),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.warning).toMatch(/WARN/)
    expect(result.parts.length).toBeGreaterThanOrEqual(2)
    for (const part of [...result.parts, ...result.interludes]) {
      expect(part.endSec - part.startSec).toBeGreaterThan(0)
    }
    for (const part of result.parts) {
      expect(part.endSec - part.startSec).toBeLessThanOrEqual(10 + 1e-6)
    }
    const covered = [...result.parts, ...result.interludes].sort((a, b) => a.startSec - b.startSec)
    expect(covered[0]!.startSec).toBeCloseTo(0, 6)
    expect(covered[covered.length - 1]!.endSec).toBeCloseTo(15, 6)
  })

  it("с запрещённой перебивкой — тот же результат без зависания", () => {
    const result = splitLongPresenterLine({
      scene: scene(degenerateWords),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: false,
    })

    expect(result.warning).toMatch(/WARN/)
    expect(result.interludes).toEqual([])
    for (const part of result.parts) {
      expect(part.endSec - part.startSec).toBeGreaterThan(0)
      expect(part.endSec - part.startSec).toBeLessThanOrEqual(10 + 1e-6)
    }
  })

  it("грубый fps ломает даже 'намеренную' паузу — каскад до потолка без зависания", () => {
    // Пауза [0.1, 0.5] длиной 0.4с формально "намеренная" (>= 0.35), но на
    // fps=1 (кадр 1с) её середина 0.3 снапается к 0 — то есть к cursor. Это
    // регрессия на внутреннюю проверку продвижения ВНУТРИ branch 1, а не
    // только на branch 2/3, как два теста выше.
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 0.1], ["два", 0.5, 3]]),
      maxDurationSec: 2,
      fps: 1,
      brollAllowed: true,
    })

    expect(result.warning).toMatch(/WARN/)
    expect(result.parts).toEqual([{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 3 }])
  })

  it("реплика без единой паузы (слова встык) режется по потолку столько раз, сколько нужно", () => {
    // Ни одной паузы вообще (endSec === startSec следующего слова everywhere) —
    // отдельная от «пауза есть, но негодная» ветка: `inRange` пуст структурно,
    // а не отфильтрован до пустоты.
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 12], ["два", 12, 25]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([
      { startSec: 0, endSec: 10 },
      { startSec: 10, endSec: 20 },
      { startSec: 20, endSec: 25 },
    ])
    expect(result.interludes).toEqual([])
    expect(result.warning).toMatch(/WARN/)
  })
})
