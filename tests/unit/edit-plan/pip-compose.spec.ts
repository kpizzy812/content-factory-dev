import { describe, expect, it } from "vitest"

import { buildPipOverlayFilter } from "~~/server/utils/video-tools/pip-compose"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"

// В тесте метку ставим напрямую: в проде её ставит только lip-sync-runner.
const synced = "scene_0_lipsync.mp4" as never

function filter(overrides: Record<string, unknown> = {}) {
  return buildPipOverlayFilter({
    foreground: synced,
    profile: { pipPosition: "bottom_right", pipSize: 0.28 },
    canvasWidth: 1080,
    canvasHeight: 1920,
    ...overrides,
  } as never).join(";")
}

/**
 * Мини-интерпретатор подмножества выражений `geq` (if/lt/gt/pow + арифметика),
 * которое реально порождает `roundedCornersAlphaExpr`. Нужен, чтобы проверить
 * не только форму строки, но и ЧИСЛЕННЫЙ результат маски в конкретных точках
 * окна — иначе регресс к брифу (скругление только одного угла) прошёл бы
 * тесты, проверяющие лишь наличие подстрок.
 *
 * ХРУПКОСТЬ (ре-ревью 1, Minor 4): словарь функций жёстко привязан к текущей
 * формуле. Легитимный рефакторинг маски на другие примитивы (`hypot`, `abs`,
 * `min`) даст `ReferenceError` вместо понятного диффа значений — при отказе
 * ниже подсказка явно называет вероятную причину, чтобы не искать её с нуля.
 */
function evalAlphaExpr(expr: string, vars: { X: number, Y: number, W: number, H: number }): number {
  const jsBody = expr.replace(/\bif\(/g, "cond(")
  let fn: (
    X: number, Y: number, W: number, H: number,
    cond: (c: number, a: number, b: number) => number,
    lt: (a: number, b: number) => number,
    gt: (a: number, b: number) => number,
    pow: (a: number, b: number) => number,
  ) => number
  try {
    // eslint-disable-next-line no-new-func -- вычисляем выражение, сгенерированное этим же тестом
    fn = new Function(
      "X", "Y", "W", "H", "cond", "lt", "gt", "pow",
      `return (${jsBody});`,
    ) as typeof fn
  } catch (err) {
    throw new Error(
      `мини-интерпретатор не смог собрать функцию из альфа-выражения "${expr}": ${String(err)}. `
      + `Если формула roundedCornersAlphaExpr была переписана на другие примитивы `
      + `(hypot/abs/min и т.п.), словарь функций evalAlphaExpr нужно расширить под них.`,
    )
  }

  try {
    return fn(
      vars.X, vars.Y, vars.W, vars.H,
      (c, a, b) => (c ? a : b),
      (a, b) => (a < b ? 1 : 0),
      (a, b) => (a > b ? 1 : 0),
      Math.pow,
    )
  } catch (err) {
    throw new Error(
      `мини-интерпретатор не смог вычислить альфа-выражение "${expr}" в точке `
      + `(X=${vars.X}, Y=${vars.Y}, W=${vars.W}, H=${vars.H}): ${String(err)}. `
      + `Вероятная причина — формула использует функцию, которой нет в словаре `
      + `evalAlphaExpr (сейчас известны только if/lt/gt/pow).`,
    )
  }
}

function alphaExprOf(graph: string): string {
  const match = graph.match(/a='([^']+)'/)
  if (!match) throw new Error("в графе нет альфа-выражения geq")
  return match[1]!
}

/** Числа окна и позиции из графа — вместо угадывания их по формуле заново. */
function overlayCoordsOf(graph: string): { x: number, y: number } {
  const match = graph.match(/overlay=(\d+):(\d+)/)
  if (!match) throw new Error("в графе нет overlay=x:y")
  return { x: Number(match[1]), y: Number(match[2]) }
}

function windowSizeOf(graph: string): { width: number, height: number } {
  const match = graph.match(/scale=(\d+):(\d+)/)
  if (!match) throw new Error("в графе нет scale=width:height")
  return { width: Number(match[1]), height: Number(match[2]) }
}

describe("наложение ведущего поверх фона", () => {
  it("масштабирует окно по доле ширины кадра", () => {
    // 1080 * 0.28 = 302.4 -> 302 (чётное, yuv420p нечётные не кодирует).
    // Якорь именно к scale=302: (М-2 ре-ревью 1) — toContain("302") совпал бы
    // с любым числом, где встречается "302" (позиция, радиус и т.д.).
    expect(filter()).toMatch(/scale=302:/)
  })

  describe("поправка ре-ревью 1: позиция угла — не только различимость, но и правильность", () => {
    // Для canvasWidth=1080, canvasHeight=1920, pipSize=0.28 окно 302x536 (см.
    // тест выше), MARGIN_PX=32 -> right=1080-302-32=746, bottom=1920-536-32=1352.
    const EXPECTED_COORDS: Record<string, { x: number, y: number }> = {
      top_left: { x: 32, y: 32 },
      top_right: { x: 746, y: 32 },
      bottom_left: { x: 32, y: 1352 },
      bottom_right: { x: 746, y: 1352 },
    }

    it.each(Object.entries(EXPECTED_COORDS))("%s даёт координаты overlay из СВОЕГО угла, а не любого", (pipPosition, expected) => {
      const graph = filter({ profile: { pipPosition, pipSize: 0.28 } })
      expect(overlayCoordsOf(graph)).toEqual(expected)
    })

    it("перестановка тел top_left/top_right в позиционировании ловится (регресс-документация)", () => {
      // Раньше "четыре угла дают четыре разные позиции" (new Set(...).size===4)
      // проходила бы и при перестановке местами тел case "top_left" и
      // case "top_right" в positionOf — множество остаётся тем же (4 разных
      // строки), просто угол называется неверно. Прямая проверка конкретных
      // координат выше эту перестановку ловит: top_left обязан быть МЕНЬШЕ по X,
      // чем top_right, а не наоборот.
      const topLeft = overlayCoordsOf(filter({ profile: { pipPosition: "top_left", pipSize: 0.28 } }))
      const topRight = overlayCoordsOf(filter({ profile: { pipPosition: "top_right", pipSize: 0.28 } }))

      expect(topLeft.x).toBeLessThan(topRight.x)
      expect(topLeft.y).toBe(topRight.y) // одна высота — верхний край
    })

    it("четыре угла дают четыре разные позиции", () => {
      const positions = (["top_left", "top_right", "bottom_left", "bottom_right"] as const)
        .map(pipPosition => filter({ profile: { pipPosition, pipSize: 0.28 } }))

      expect(new Set(positions).size).toBe(4)
    })
  })

  it("скругляет углы окна", () => {
    expect(filter()).toMatch(/geq|alphaextract|format=rgba/)
  })

  describe("окно не выпускает за пределы кадра ни по одной оси", () => {
    it("портретный холст (1080x1920), pipSize=0.5 — проверка по X и по Y", () => {
      const graph = filter({ profile: { pipPosition: "bottom_right", pipSize: 0.5 } })
      const { x, y } = overlayCoordsOf(graph)
      const { width, height } = windowSizeOf(graph)

      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + width).toBeLessThanOrEqual(1080)
      // М-1 ре-ревью 1: раньше по Y проверки не было вовсе — ровно та ось,
      // на которой ломается альбомный холст (см. блок ниже).
      expect(y + height).toBeLessThanOrEqual(1920)
    })

    it("альбомный холст (1920x1080), pipSize=0.5 — окно физически помещается по обеим осям", () => {
      // Ре-ревью 1, Important 1: до фикса windowHeight считался как
      // windowWidth*16/9 БЕЗ проверки на высоту холста и давал scale=960:1706 —
      // окно выше самого кадра (1080px). positionOf защищала только координату
      // (max(0, ...)), а не сам размер.
      const graph = filter({
        profile: { pipPosition: "bottom_right", pipSize: 0.5 },
        canvasWidth: 1920,
        canvasHeight: 1080,
      })
      const { x, y } = overlayCoordsOf(graph)
      const { width, height } = windowSizeOf(graph)

      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + width).toBeLessThanOrEqual(1920)
      expect(y + height).toBeLessThanOrEqual(1080)
      // Явно фиксируем сам факт зажима — без него это условие выполнялось бы
      // тривиально даже на сломанном коде, если бы сломанный размер случайно
      // оказался маленьким.
      expect(height).toBeLessThan(width * (16 / 9))
    })

    it("на альбомном холсте окно остаётся портретным по форме (не превращается в горизонтальную полосу)", () => {
      const graph = filter({
        profile: { pipPosition: "top_left", pipSize: 0.5 },
        canvasWidth: 1920,
        canvasHeight: 1080,
      })
      const { width, height } = windowSizeOf(graph)

      expect(height).toBeGreaterThan(width) // всё ещё выше, чем шире — портрет, а не альбом
    })
  })

  it("выравнивает размер окна до чётного", () => {
    const graph = filter({ profile: { pipPosition: "top_left", pipSize: 0.333 } })
    const { width } = windowSizeOf(graph)

    expect(width % 2).toBe(0)
  })

  it("накладывает ведущего НА фон: порядок входов overlay фиксирован", () => {
    // Мутация порядка ([pip][0:v]overlay=...) даёт фон ПОВЕРХ ведущего — PiP
    // пропадает целиком, и предыдущие тесты этого не заметили бы: числа
    // позиции и размера окна при перестановке входов не меняются.
    expect(filter()).toContain("[0:v][pip]overlay=")
  })

  describe("поправка к брифу: маска обязана скруглять все четыре угла", () => {
    it("альфа-выражение использует обе границы окна (ширину и высоту), а не только координаты от нуля", () => {
      const alphaExpr = alphaExprOf(filter())

      // Скругление только левого верхнего угла (баг брифа) выражается через
      // сравнение X и Y с радиусом от нуля и не ссылается на противоположную
      // границу окна (W-radius, H-radius) — такое выражение не режет три
      // остальных угла.
      expect(alphaExpr).toMatch(/W\s*-/)
      expect(alphaExpr).toMatch(/H\s*-/)
    })

    it("маска численно прозрачна во всех четырёх углах окна, не только в левом верхнем", () => {
      // 1080 * 0.28 -> 302 (even), 302 * 16/9 -> 536 (even) — те же числа,
      // что и в первом тесте набора.
      const W = 302
      const H = 536
      const alphaExpr = alphaExprOf(filter())

      const corners = [
        { X: 0, Y: 0 },
        { X: W - 1, Y: 0 },
        { X: 0, Y: H - 1 },
        { X: W - 1, Y: H - 1 },
      ]

      for (const corner of corners) {
        expect(evalAlphaExpr(alphaExpr, { ...corner, W, H })).toBe(0)
      }
    })

    it("маска непрозрачна в центре и на серединах прямых рёбер окна", () => {
      const W = 302
      const H = 536
      const alphaExpr = alphaExprOf(filter())

      const nonCornerPoints = [
        { X: Math.floor(W / 2), Y: Math.floor(H / 2) }, // центр
        { X: Math.floor(W / 2), Y: 0 }, // середина верхнего края
        { X: Math.floor(W / 2), Y: H - 1 }, // середина нижнего края
        { X: 0, Y: Math.floor(H / 2) }, // середина левого края
        { X: W - 1, Y: Math.floor(H / 2) }, // середина правого края
      ]

      for (const point of nonCornerPoints) {
        expect(evalAlphaExpr(alphaExpr, { ...point, W, H })).toBe(255)
      }
    })

    it("нулевой радиус даёт прямоугольное окно без маски, но не ломает граф", () => {
      const graph = filter({ cornerRadiusPx: 0 })

      expect(graph).toContain("a='255'")
    })
  })

  it("реальный дефолтный монтажный профиль (Task 2) собирается без ошибок", () => {
    // Использует DEFAULT_EDIT_PROFILE напрямую: это тот профиль, который
    // реально уйдёт в сборку, если оператор не переопределил PiP.
    const graph = filter({
      profile: { pipPosition: DEFAULT_EDIT_PROFILE.pipPosition, pipSize: DEFAULT_EDIT_PROFILE.pipSize },
    })

    expect(graph).toContain("overlay=")
    expect(graph).toMatch(/scale=302:/) // pipSize по умолчанию 0.28 -> то же окно, что и в первом тесте
  })
})
