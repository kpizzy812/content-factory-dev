import { describe, expect, it } from "vitest"

import { splitLongPresenterLine } from "~~/server/utils/edit-plan/split-line"

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

  it("узкая пауза у самого начала не даёт вырожденную перебивку — падает в резерв branch 3", () => {
    // Мутация: ловит удаление проверки "from > cursor" в branch 2. Пауза
    // [0.008, 0.3] после притяжки к кадру (fps=30) снапает начало К cursor'у
    // (0.008 -> 0), а конец — уже нет (0.3 остаётся собственным кадром). Без
    // проверки `from > cursor` branch 2 принял бы это как перебивку и отдал
    // бы часть [0, 0] нулевой длины; с проверкой — управление уходит в branch 3.
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 0.008], ["два", 0.3, 15]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.interludes).toEqual([])
    expect(result.parts[0]!.endSec - result.parts[0]!.startSec).toBeGreaterThan(0)
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
