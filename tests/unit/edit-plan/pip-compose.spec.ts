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
 */
function evalAlphaExpr(expr: string, vars: { X: number, Y: number, W: number, H: number }): number {
  const jsBody = expr.replace(/\bif\(/g, "cond(")
  // eslint-disable-next-line no-new-func -- вычисляем выражение, сгенерированное этим же тестом
  const fn = new Function(
    "X", "Y", "W", "H", "cond", "lt", "gt", "pow",
    `return (${jsBody});`,
  ) as (
    X: number, Y: number, W: number, H: number,
    cond: (c: number, a: number, b: number) => number,
    lt: (a: number, b: number) => number,
    gt: (a: number, b: number) => number,
    pow: (a: number, b: number) => number,
  ) => number

  return fn(
    vars.X, vars.Y, vars.W, vars.H,
    (c, a, b) => (c ? a : b),
    (a, b) => (a < b ? 1 : 0),
    (a, b) => (a > b ? 1 : 0),
    Math.pow,
  )
}

function alphaExprOf(graph: string): string {
  const match = graph.match(/a='([^']+)'/)
  if (!match) throw new Error("в графе нет альфа-выражения geq")
  return match[1]!
}

describe("наложение ведущего поверх фона", () => {
  it("масштабирует окно по доле ширины кадра", () => {
    // 1080 * 0.28 = 302.4 -> 302 (чётное, yuv420p нечётные не кодирует).
    expect(filter()).toContain("302")
  })

  it("ставит окно в заданный угол", () => {
    expect(filter({ profile: { pipPosition: "bottom_right", pipSize: 0.28 } })).toContain("overlay=")
    expect(filter({ profile: { pipPosition: "top_left", pipSize: 0.28 } })).toMatch(/overlay=\d+:\d+/)
  })

  it("четыре угла дают четыре разные позиции", () => {
    const positions = (["top_left", "top_right", "bottom_left", "bottom_right"] as const)
      .map(pipPosition => filter({ profile: { pipPosition, pipSize: 0.28 } }))

    expect(new Set(positions).size).toBe(4)
  })

  it("скругляет углы окна", () => {
    expect(filter()).toMatch(/geq|alphaextract|format=rgba/)
  })

  it("не выпускает окно за пределы кадра", () => {
    const graph = filter({ profile: { pipPosition: "bottom_right", pipSize: 0.5 } })
    const [, x, y] = graph.match(/overlay=(\d+):(\d+)/)!

    expect(Number(x)).toBeGreaterThanOrEqual(0)
    expect(Number(y)).toBeGreaterThanOrEqual(0)
    expect(Number(x) + 540).toBeLessThanOrEqual(1080)
  })

  it("выравнивает размер окна до чётного", () => {
    const graph = filter({ profile: { pipPosition: "top_left", pipSize: 0.333 } })
    const [, width] = graph.match(/scale=(\d+):/)!

    expect(Number(width) % 2).toBe(0)
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
    expect(graph).toContain("302") // pipSize по умолчанию 0.28 -> то же окно, что и в первом тесте
  })
})
