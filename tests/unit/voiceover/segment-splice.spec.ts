/**
 * Планирование вклейки пересинтезированной фразы (spec §4.5).
 *
 * Тесты из брифа усилены после разбора мутаций: проверяются ЗНАЧЕНИЯ точек
 * реза, а не только их попадание внутрь паузы — иначе рез по КРАЮ паузы (то
 * есть по первому звуку соседней фразы) прошёл бы проверку наравне с резом по
 * середине, а щелчок на стыке услышал бы зритель. Притяжка к кадру проверяется
 * на точках, которые на границу кадра НЕ попадают сами по себе: на круглых
 * 4.0/9.8 при fps 30 округление ничего не меняет и дыру не показывает.
 *
 * Граф `filter_complex` сравнивается целиком, а не по вхождению подстрок:
 * перепутанные метки дают ffmpeg, который отработает молча и склеит не то.
 */

import { describe, expect, it } from "vitest"

import {
  DEFAULT_SPLICE_CROSSFADE_SEC,
  buildSpliceFilters,
  planSegmentSplice,
  type SpliceInput,
} from "~~/server/utils/voiceover/segment-splice"

const SILENCES = [
  { startSec: 3.8, endSec: 4.2 },
  { startSec: 9.5, endSec: 10.1 },
]

function input(overrides: Partial<SpliceInput> = {}): SpliceInput {
  return {
    sceneStartSec: 4.0,
    sceneEndSec: 9.8,
    trackDurationSec: 20,
    fps: 30,
    silences: SILENCES,
    ...overrides,
  }
}

/** Расстояние точки до ближайшей границы кадра — для проверки притяжки. */
function frameOffset(sec: number, fps: number): number {
  return Math.abs(sec * fps - Math.round(sec * fps))
}

describe("планирование вклейки пересинтезированной фразы", () => {
  it("режет по серединам ближайших пауз, а не по границам сцены", () => {
    // Край паузы — это первый звук соседней фразы. Середина оставляет запас
    // тишины с обеих сторон, и склейка не слышна.
    const plan = planSegmentSplice(input())!

    expect(plan.cutStartSec).toBeGreaterThanOrEqual(3.8)
    expect(plan.cutStartSec).toBeLessThanOrEqual(4.2)
    expect(plan.cutEndSec).toBeGreaterThanOrEqual(9.5)
    expect(plan.cutEndSec).toBeLessThanOrEqual(10.1)
    expect(plan.anchoredToSilence).toEqual({ start: true, end: true })
  })

  it("берёт именно середину паузы, а не её край", () => {
    // Паузы намеренно несимметричны относительно границ сцены: и край паузы, и
    // граница сцены попали бы в интервал предыдущей проверки, а середина — это
    // одно конкретное число.
    const plan = planSegmentSplice(input({
      silences: [{ startSec: 3.6, endSec: 4.0 }, { startSec: 9.6, endSec: 10.2 }],
    }))!

    expect(plan.cutStartSec).toBeCloseTo(3.8, 6)
    expect(plan.cutEndSec).toBeCloseTo(9.9, 6)
  })

  it("притягивает точки реза к границе кадра", () => {
    const plan = planSegmentSplice(input())!

    expect(frameOffset(plan.cutStartSec, 30)).toBeLessThan(1e-6)
    expect(frameOffset(plan.cutEndSec, 30)).toBeLessThan(1e-6)
  })

  it("притягивает к кадру середину паузы, а не отдаёт её как есть", () => {
    // Середина 3.88 с при 30 fps лежит между кадрами 116 и 117. Звук, начатый в
    // середине кадра, уезжает от картинки на полкадра уже на старте — и ключ
    // переиспользования куска (`segmentIdentity`) считается по притянутым
    // границам, иначе весь ролик переоплатит lip-sync (решение №3 плана).
    const plan = planSegmentSplice(input({ silences: [{ startSec: 3.75, endSec: 4.01 }] }))!

    expect(plan.anchoredToSilence.start).toBe(true)
    expect(plan.cutStartSec).toBeCloseTo(116 / 30, 6)
    expect(plan.cutStartSec).not.toBeCloseTo(3.88, 6)
  })

  it("притягивает к кадру и границу сцены, когда паузы нет", () => {
    const plan = planSegmentSplice(input({ sceneStartSec: 4.017, sceneEndSec: 9.817, silences: [] }))!

    expect(plan.cutStartSec).toBeCloseTo(121 / 30, 6)
    expect(plan.cutEndSec).toBeCloseTo(295 / 30, 6)
  })

  it("без подходящей паузы режет по границе сцены и говорит об этом", () => {
    const plan = planSegmentSplice(input({ silences: [] }))!

    expect(plan.cutStartSec).toBeCloseTo(4.0, 2)
    expect(plan.cutEndSec).toBeCloseTo(9.8, 2)
    expect(plan.anchoredToSilence).toEqual({ start: false, end: false })
  })

  it("не берёт паузу дальше допуска — это уже чужая фраза", () => {
    // Пауза в 2 секундах от границы сцены принадлежит соседней реплике:
    // вклейка по ней стёрла бы чужой текст.
    const plan = planSegmentSplice(input({ silences: [{ startSec: 1.5, endSec: 2.0 }] }))!

    expect(plan.anchoredToSilence.start).toBe(false)
  })

  it("из нескольких пауз в допуске берёт ближайшую, а не первую и не последнюю", () => {
    // Ближайшая пауза лежит В СЕРЕДИНЕ списка: и «первая подошедшая», и
    // «последняя подошедшая» дали бы другую точку реза, то есть съели бы кусок
    // соседней реплики.
    const plan = planSegmentSplice(input({
      silences: [
        { startSec: 4.4, endSec: 4.6 },
        { startSec: 3.75, endSec: 4.05 },
        { startSec: 4.25, endSec: 4.45 },
      ],
    }))!

    expect(plan.cutStartSec).toBeCloseTo(3.9, 6)
  })

  it("не считает паузой диапазон нулевой длины", () => {
    // Вырожденный диапазон стоит ровно на границе сцены и по расстоянию бьёт
    // настоящую паузу — но тишины в нём нет ни миллисекунды, и рез по нему это
    // рез посреди слова.
    const plan = planSegmentSplice(input({
      silences: [{ startSec: 4.0, endSec: 4.0 }, { startSec: 3.6, endSec: 4.0 }],
    }))!

    expect(plan.cutStartSec).toBeCloseTo(3.8, 6)
  })

  it("не считает паузой диапазон с нечисловыми границами", () => {
    // Разметка тишины best-effort и переживает сериализацию в снапшот шага:
    // `null` вместо секунды в арифметике становится нулём, и «пауза» 0…0.8 с
    // выглядела бы как настоящая — рез уехал бы в середину первого слова.
    const plan = planSegmentSplice(input({
      sceneStartSec: 0.5,
      sceneEndSec: 5,
      silences: [{ startSec: null as unknown as number, endSec: 0.8 }],
    }))!

    expect(plan.anchoredToSilence.start).toBe(false)
    expect(plan.cutStartSec).toBeCloseTo(0.5, 6)
  })

  it("не вылезает за начало и конец трека", () => {
    const plan = planSegmentSplice(input({
      sceneStartSec: 0,
      sceneEndSec: 20,
      trackDurationSec: 20,
      silences: [],
    }))!

    expect(plan.cutStartSec).toBeGreaterThanOrEqual(0)
    expect(plan.cutEndSec).toBeLessThanOrEqual(20)
  })

  it("обрезает границы сцены, вылезшие за трек в обе стороны", () => {
    // Выравнивание может отдать границы чуть за пределами трека; резать по ним
    // значит просить ffmpeg о куске, которого в файле нет.
    const plan = planSegmentSplice(input({
      sceneStartSec: -0.4,
      sceneEndSec: 25,
      trackDurationSec: 20,
      silences: [],
    }))!

    expect(plan.cutStartSec).toBe(0)
    expect(plan.cutEndSec).toBeCloseTo(20, 6)
  })

  it("отказывает на бессмысленном интервале", () => {
    expect(planSegmentSplice(input({ sceneStartSec: 9, sceneEndSec: 4 }))).toBeNull()
    expect(planSegmentSplice(input({ trackDurationSec: 0 }))).toBeNull()
  })

  it("отказывает на перевёрнутом интервале, даже если паузы его «чинят»", () => {
    // Конец раньше начала — это сломанное выравнивание. Паузы по бокам развели
    // бы точки реза в правильном порядке, и вклейка прошла бы по интервалу,
    // которого в сценарии нет.
    expect(planSegmentSplice(input({
      sceneStartSec: 5,
      sceneEndSec: 4.9,
      silences: [{ startSec: 4.4, endSec: 4.8 }, { startSec: 5.2, endSec: 5.6 }],
    }))).toBeNull()
  })

  it("отказывает, когда сцена целиком за концом трека", () => {
    expect(planSegmentSplice(input({
      sceneStartSec: 21,
      sceneEndSec: 25,
      trackDurationSec: 20,
      silences: [],
    }))).toBeNull()
  })

  it("отказывает на нечисловых границах", () => {
    expect(planSegmentSplice(input({ sceneStartSec: Number.NaN }))).toBeNull()
    expect(planSegmentSplice(input({ sceneEndSec: Number.NaN }))).toBeNull()
    expect(planSegmentSplice(input({ trackDurationSec: Number.NaN }))).toBeNull()
  })

  it("кроссфейд короткий и не съедает речь", () => {
    const plan = planSegmentSplice(input())!

    expect(plan.crossfadeSec).toBeGreaterThan(0)
    expect(plan.crossfadeSec).toBeLessThanOrEqual(0.05)
    expect(plan.crossfadeSec).toBe(DEFAULT_SPLICE_CROSSFADE_SEC)
  })

  it("кроссфейд можно задать явно", () => {
    const plan = planSegmentSplice(input({ crossfadeSec: 0.04 }))!

    expect(plan.crossfadeSec).toBe(0.04)
  })
})

describe("граф склейки трека с новой фразой", () => {
  it("собирает граф склейки из трёх кусков", () => {
    const plan = planSegmentSplice(input())!
    const graph = buildSpliceFilters(plan, 6.2, 20).join(";")

    // Голова трека, новая фраза, хвост трека.
    expect(graph).toContain("atrim=0")
    expect(graph).toContain("acrossfade")
    expect(graph).toMatch(/\[aout\]$/)
    // Выход ровно один: два `[aout]` в графе — это ffmpeg, который возьмёт не тот.
    expect(graph.match(/\[aout\]/g)).toHaveLength(1)
  })

  it("строит граф из трёх кусков ровно так, как его получит ffmpeg", () => {
    // Полное сравнение, а не поиск подстрок: перепутанный вход (`[0:a]` вместо
    // `[1:a]`), потерянная цепочка меток или подставленная не та длительность
    // дают валидный граф, который склеит не тот звук и не пожалуется.
    const plan = planSegmentSplice(input())!

    expect(buildSpliceFilters(plan, 6.2, 20)).toEqual([
      "[0:a]atrim=0:4.000,asetpts=N/SR/TB[head]",
      "[1:a]atrim=0:6.200,asetpts=N/SR/TB[mid]",
      "[0:a]atrim=9.800:20.000,asetpts=N/SR/TB[tail]",
      "[head][mid]acrossfade=d=0.020:c1=tri:c2=tri[mix1]",
      "[mix1][tail]acrossfade=d=0.020:c1=tri:c2=tri[aout]",
    ])
  })

  it("не строит голову, когда резать начинают с нуля", () => {
    const plan = planSegmentSplice(input({ sceneStartSec: 0, sceneEndSec: 5, silences: [] }))!
    const graph = buildSpliceFilters(plan, 4, 20).join(";")

    // Пустой кусок в concat даёт ffmpeg-ошибку, а не пустой звук.
    expect(graph).not.toContain("atrim=0.000:0.000")
    expect(graph).not.toContain("head")
    expect(graph).toMatch(/\[aout\]$/)
  })

  it("не строит хвост, когда рез доходит до конца трека", () => {
    const plan = planSegmentSplice(input({ sceneStartSec: 5, sceneEndSec: 20, silences: [] }))!
    const graph = buildSpliceFilters(plan, 4, 20).join(";")

    expect(graph).not.toContain("tail")
    expect(graph).toMatch(/\[aout\]$/)
  })

  it("отдаёт выход даже когда новая фраза заменяет трек целиком", () => {
    // Кроссфейду не с чем работать: склеивать не с чем. Метка `[aout]` всё
    // равно обязана существовать — иначе ffmpeg нечего мапить в файл.
    const plan = planSegmentSplice(input({ sceneStartSec: 0, sceneEndSec: 20, silences: [] }))!

    expect(buildSpliceFilters(plan, 6.2, 20)).toEqual([
      "[1:a]atrim=0:6.200,asetpts=N/SR/TB[mid]",
      "[mid]anull[aout]",
    ])
  })

  it("кладёт в граф кроссфейд из плана, а не константу", () => {
    const plan = planSegmentSplice(input({ crossfadeSec: 0.04 }))!
    const graph = buildSpliceFilters(plan, 6.2, 20).join(";")

    expect(graph).toContain("acrossfade=d=0.040")
  })
})
