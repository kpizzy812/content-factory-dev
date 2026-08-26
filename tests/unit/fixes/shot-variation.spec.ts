/**
 * Смена плана внутри сцены.
 *
 * Сцена длиной 9 секунд идёт одним статичным кадром: удержание падает, а
 * последовательность перцептивных хешей у двух роликов с одной ведущей выходит
 * почти одинаковой — платформы сравнивают именно её. Практика короткого видео
 * держит смену картинки каждые 1.5-2 секунды; медленное движение внутри кадра
 * даёт её без единого лишнего платного вызова, средствами монтажа.
 *
 * Здесь проверяется построение фильтра ffmpeg: сам монтаж запускается только в
 * сборке, а выбор плана и его выражения обязаны проверяться без процесса.
 */

import { describe, expect, it } from "vitest"
import {
  SHOT_VARIATION_PLANS,
  buildShotVariationFilter,
  pickShotVariationPlan,
  planShotVariationSlices,
  shotBackgroundIdentity,
} from "../../../server/utils/video-tools/shot-variation"

const PORTRAIT = { w: 1080, h: 1920 }

/**
 * Числовая проверка ТРАЕКТОРИИ, а не текста фильтра.
 *
 * Выражения ffmpeg для `+ - * /` и скобок совпадают с JS посимвольно, поэтому
 * позицию окна кропа в момент `t` можно посчитать здесь же и сравнить два
 * куска одной группы между собой. Сравнение строк такого не даёт: у кусков
 * РАЗНЫЕ выражения (у второго добавлено смещение), и непрерывность видна
 * только в числах.
 */
function cropXAt(filter: string, t: number): number {
  const crop = filter.match(/crop=\d+:\d+:([^:]+):/)
  if (!crop) throw new Error(`в фильтре нет выражения кропа: ${filter}`)
  // eslint-disable-next-line no-new-func
  return Number(new Function("t", `return ${crop[1]}`)(t))
}

function cropYAt(filter: string, t: number): number {
  const crop = filter.match(/crop=\d+:\d+:[^:]+:(.+)$/)
  if (!crop) throw new Error(`в фильтре нет выражения кропа: ${filter}`)
  // eslint-disable-next-line no-new-func
  return Number(new Function("t", `return ${crop[1]}`)(t))
}

function scaleWidthAt(filter: string, t: number): number {
  const scale = filter.match(/scale='([^']+)'/)
  if (!scale) throw new Error(`в фильтре нет выражения масштаба: ${filter}`)
  // eslint-disable-next-line no-new-func
  return Number(new Function("t", `return ${scale[1]}`)(t))
}

describe("pickShotVariationPlan", () => {
  it("соседние сцены получают разные планы", () => {
    const plans = [0, 1, 2].map(index => pickShotVariationPlan(index))
    expect(new Set(plans).size).toBe(3)
  })

  it("выбор детерминирован: тот же индекс — тот же план", () => {
    // Пересборка ролика обязана давать тот же файл, иначе кеш нормализации и
    // отпечаток уникальности расходятся между прогонами.
    expect(pickShotVariationPlan(4)).toBe(pickShotVariationPlan(4))
  })

  it("отрицательный и дробный индекс не роняют выбор", () => {
    expect(SHOT_VARIATION_PLANS).toContain(pickShotVariationPlan(-3))
    expect(SHOT_VARIATION_PLANS).toContain(pickShotVariationPlan(2.7))
  })
})

describe("buildShotVariationFilter", () => {
  it("кадр на выходе остаётся форматным: обрезка идёт из увеличенного исходника", () => {
    // Выход обязан быть ровно 1080x1920 — иначе concat склеит кадры разных
    // размеров и ролик развалится уже в ffmpeg.
    const filter = buildShotVariationFilter("pan_left", PORTRAIT, 9)
    expect(filter).toContain("crop=1080:1920")
    expect(filter).toMatch(/scale=\d+:\d+/)
  })

  it("движение привязано ко времени сцены, а не к номеру кадра", () => {
    const filter = buildShotVariationFilter("pan_right", PORTRAIT, 9)
    expect(filter).toContain("t/9")
  })

  it("статичный план тоже кадрирует: он отличает сцену от исходника", () => {
    const filter = buildShotVariationFilter("static_tight", PORTRAIT, 9)
    expect(filter).toContain("crop=1080:1920")
    expect(filter).not.toContain("t/")
  })

  it("нулевая и отрицательная длительность не дают деления на ноль", () => {
    for (const duration of [0, -5, Number.NaN]) {
      const filter = buildShotVariationFilter("pan_left", PORTRAIT, duration)
      expect(filter).not.toContain("/0")
      expect(filter).not.toContain("NaN")
    }
  })

  it("все планы дают валидный фильтр для обоих форматов", () => {
    for (const plan of SHOT_VARIATION_PLANS) {
      for (const target of [PORTRAIT, { w: 1920, h: 1080 }]) {
        const filter = buildShotVariationFilter(plan, target, 7)
        expect(filter).toContain(`crop=${target.w}:${target.h}`)
      }
    }
  })

  it("разные планы дают разные фильтры — иначе смены плана нет", () => {
    const filters = SHOT_VARIATION_PLANS.map(plan => buildShotVariationFilter(plan, PORTRAIT, 9))
    expect(new Set(filters).size).toBe(SHOT_VARIATION_PLANS.length)
  })

  it("нулевое смещение не меняет фильтр — старый маршрут получает те же аргументы", () => {
    // Перебивка старого маршрута зовёт фильтр без смещения вовсе; байт в байт
    // тот же результат — единственная гарантия, что кадровая правка не задела
    // уже работающий контур.
    for (const plan of SHOT_VARIATION_PLANS) {
      expect(buildShotVariationFilter(plan, PORTRAIT, 9, 0)).toBe(buildShotVariationFilter(plan, PORTRAIT, 9))
    }
  })

  it("смещение продолжает траекторию, а не перезапускает её", () => {
    // Группа 5.4с из трёх кусков по 1.8с. Второй кусок обязан НАЧАТЬ там, где
    // первый ЗАКОНЧИЛ: иначе фон дёргается на каждой склейке (дефект ролика 30).
    const span = 5.4
    for (const plan of ["pan_left", "pan_right"] as const) {
      const first = buildShotVariationFilter(plan, PORTRAIT, span, 0)
      const second = buildShotVariationFilter(plan, PORTRAIT, span, 1.8)
      const third = buildShotVariationFilter(plan, PORTRAIT, span, 3.6)
      expect(cropXAt(second, 0)).toBeCloseTo(cropXAt(first, 1.8), 6)
      expect(cropXAt(third, 0)).toBeCloseTo(cropXAt(second, 1.8), 6)
      // И траектория остаётся МОНОТОННОЙ: без этого «непрерывность» можно
      // получить и стоячим кадром.
      expect(Math.abs(cropXAt(third, 1.8) - cropXAt(first, 0))).toBeGreaterThan(1)
    }
  })

  it("вертикальная панорама и наезд тоже продолжаются, а не перезапускаются", () => {
    const span = 5.4
    const upFirst = buildShotVariationFilter("pan_up", PORTRAIT, span, 0)
    const upSecond = buildShotVariationFilter("pan_up", PORTRAIT, span, 1.8)
    expect(cropYAt(upSecond, 0)).toBeCloseTo(cropYAt(upFirst, 1.8), 6)

    const pushFirst = buildShotVariationFilter("push_in", PORTRAIT, span, 0)
    const pushSecond = buildShotVariationFilter("push_in", PORTRAIT, span, 1.8)
    expect(scaleWidthAt(pushSecond, 0)).toBeCloseTo(scaleWidthAt(pushFirst, 1.8), 6)
    expect(scaleWidthAt(pushSecond, 1.8)).toBeGreaterThan(scaleWidthAt(pushFirst, 0))
  })

  it("нечисловое и отрицательное смещение не портит выражение", () => {
    for (const offset of [Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      const filter = buildShotVariationFilter("pan_left", PORTRAIT, 9, offset)
      expect(filter).not.toContain("NaN")
      expect(filter).not.toContain("Infinity")
      expect(filter).not.toContain("--")
    }
  })
})

describe("shotBackgroundIdentity", () => {
  it("одна идея — одна идентичность, разные идеи — разные", () => {
    const base = { background: "image", backgroundClipId: null, appReferenceId: null, idea: "Полка с банками" }
    expect(shotBackgroundIdentity(base)).toBe(shotBackgroundIdentity({ ...base }))
    expect(shotBackgroundIdentity(base)).not.toBe(shotBackgroundIdentity({ ...base, idea: "Стакан сока" }))
  })

  it("библиотечный фон и скрин адресуются своей ссылкой, а не идеей", () => {
    const lib = { background: "library", backgroundClipId: "clip-1", appReferenceId: null, idea: null }
    expect(shotBackgroundIdentity(lib)).toBe(shotBackgroundIdentity({ ...lib, idea: "другая идея" }))
    expect(shotBackgroundIdentity(lib)).not.toBe(shotBackgroundIdentity({ ...lib, backgroundClipId: "clip-2" }))

    const screen = { background: "app_screen", backgroundClipId: null, appReferenceId: "ref-1", idea: null }
    expect(shotBackgroundIdentity(screen)).not.toBe(shotBackgroundIdentity({ ...screen, appReferenceId: "ref-2" }))
  })

  it("фона нет или идея пуста — идентичности нет: такой кадр не группируется", () => {
    expect(shotBackgroundIdentity({ background: "none", backgroundClipId: null, appReferenceId: null, idea: "x" })).toBeNull()
    expect(shotBackgroundIdentity({ background: "image", backgroundClipId: null, appReferenceId: null, idea: null })).toBeNull()
    expect(shotBackgroundIdentity({ background: "image", backgroundClipId: null, appReferenceId: null, idea: "   " })).toBeNull()
  })

  it("картинка и генеративное видео с одной идеей — РАЗНЫЕ фоны", () => {
    const idea = "Полка с банками"
    expect(shotBackgroundIdentity({ background: "image", backgroundClipId: null, appReferenceId: null, idea }))
      .not.toBe(shotBackgroundIdentity({ background: "video", backgroundClipId: null, appReferenceId: null, idea }))
  })
})

describe("planShotVariationSlices", () => {
  const shot = (order: number, startSec: number, endSec: number, backgroundKey: string | null) =>
    ({ order, startSec, endSec, backgroundKey })

  it("подряд идущие кадры одного фона — одна группа, одна траектория", () => {
    // Ролик 30: кадры 0-3 одна идея, 4-6 другая. Внутри группы движение
    // непрерывно, между группами — разное.
    const slices = planShotVariationSlices([
      shot(0, 0, 1.8, "image:A"),
      shot(1, 1.8, 3.6, "image:A"),
      shot(2, 3.6, 5.4, "image:A"),
      shot(3, 5.4, 7.2, "image:B"),
    ])

    expect(slices.get(0)!.index).toBe(slices.get(1)!.index)
    expect(slices.get(1)!.index).toBe(slices.get(2)!.index)
    expect(slices.get(3)!.index).not.toBe(slices.get(0)!.index)

    // Смещение второго куска равно длине первого — прямое требование задачи.
    expect(slices.get(0)!.offsetSec).toBeCloseTo(0, 9)
    expect(slices.get(1)!.offsetSec).toBeCloseTo(1.8, 9)
    expect(slices.get(2)!.offsetSec).toBeCloseTo(3.6, 9)
    for (const order of [0, 1, 2]) expect(slices.get(order)!.spanSec).toBeCloseTo(5.4, 9)
    // Новая группа считает траекторию заново.
    expect(slices.get(3)!.offsetSec).toBeCloseTo(0, 9)
    expect(slices.get(3)!.spanSec).toBeCloseTo(1.8, 9)
  })

  it("соседние группы получают РАЗНЫЕ планы движения", () => {
    const slices = planShotVariationSlices([
      shot(0, 0, 1.8, "image:A"),
      shot(1, 1.8, 3.6, "image:A"),
      shot(2, 3.6, 5.4, "image:B"),
      shot(3, 5.4, 7.2, "image:C"),
    ])
    const plans = [0, 2, 3].map(order => pickShotVariationPlan(slices.get(order)!.index))
    expect(plans[0]).not.toBe(plans[1])
    expect(plans[1]).not.toBe(plans[2])
  })

  it("кадр без идентичности фона стоит в своей группе — соседи его не поглощают", () => {
    const slices = planShotVariationSlices([
      shot(0, 0, 1.8, null),
      shot(1, 1.8, 3.6, null),
      shot(2, 3.6, 5.4, "image:A"),
    ])
    expect(slices.get(0)!.index).not.toBe(slices.get(1)!.index)
    expect(slices.get(0)!.spanSec).toBeCloseTo(1.8, 9)
    expect(slices.get(1)!.spanSec).toBeCloseTo(1.8, 9)
  })

  it("разрыв во времени рвёт группу, даже если фон тот же", () => {
    // Кадры одной идеи, но между ними чужой интервал: продолжать траекторию
    // через дыру значит соврать про длину группы.
    const slices = planShotVariationSlices([
      shot(0, 0, 1.8, "image:A"),
      shot(1, 5.0, 6.8, "image:A"),
    ])
    expect(slices.get(0)!.index).not.toBe(slices.get(1)!.index)
    expect(slices.get(1)!.offsetSec).toBeCloseTo(0, 9)
  })

  it("нечисловые границы не превращают траекторию в NaN", () => {
    const slices = planShotVariationSlices([
      shot(0, 0, 1.8, "image:A"),
      shot(1, Number.NaN, 3.6, "image:A"),
    ])
    for (const slice of slices.values()) {
      expect(Number.isFinite(slice.offsetSec)).toBe(true)
      expect(Number.isFinite(slice.spanSec)).toBe(true)
      expect(slice.spanSec).toBeGreaterThan(0)
    }
  })
})
