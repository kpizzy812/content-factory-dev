/**
 * Громкость закадрового голоса приводится к цели, а не берётся «как отдала модель».
 *
 * Измерено на одной и той же реплике: MiniMax отдаёт −25.8 LUFS, Fish −17.4.
 * Разброс 8 LU между моделями и 5.2 LU относительно живой записи ведущей
 * (−22.6). Смена модели озвучки уводила громкость всей партии, а площадки
 * (TikTok, YouTube, Instagram) приводят ролик к своим ~−14 LUFS сами: тихий
 * поднимут вместе с шумом, громкий прижмут. Лучше прийти туда своими руками.
 *
 * Компрессор при этом НЕ ставим: обе модели отдают диапазон 0.7–0.9 LU против
 * 12.8 LU у живой записи — они уже пережаты, дожимать нечего и вредно.
 */

import { describe, expect, it } from "vitest"
import {
  LIMITER_CEILING,
  LOUDNESS_TARGET,
  buildLoudnormApplyFilter,
  buildLoudnormMeasureFilter,
  parseLoudnormMeasurement,
} from "~~/server/utils/video-tools/loudness"

describe("цель громкости", () => {
  it("совпадает с тем, к чему приводят площадки", () => {
    expect(LOUDNESS_TARGET.integratedLufs).toBe(-14)
    // Запас до цифрового потолка: после сведения с музыкой пики складываются.
    expect(LOUDNESS_TARGET.truePeakDb).toBeLessThanOrEqual(-1)
  })
})

describe("потолок лимитера", () => {
  it("выражен в линейной амплитуде — alimiter принимает её, а не децибелы", () => {
    // −1.5 dBTP → 10^(−1.5/20) ≈ 0.841. Передать сюда «-1.5» значило бы
    // задать отрицательный потолок и получить тишину.
    expect(LIMITER_CEILING).toBeGreaterThan(0)
    expect(LIMITER_CEILING).toBeLessThan(1)
    expect(LIMITER_CEILING).toBeCloseTo(10 ** (LOUDNESS_TARGET.truePeakDb / 20), 4)
  })
})

describe("первый проход — замер", () => {
  it("просит loudnorm отчитаться в JSON и ничего не менять", () => {
    const filter = buildLoudnormMeasureFilter()
    expect(filter).toContain("loudnorm")
    expect(filter).toContain("print_format=json")
    expect(filter).toContain("I=-14")
  })
})

describe("разбор замера", () => {
  const stderr = `[Parsed_loudnorm_0 @ 000001]
{
	"input_i" : "-17.42",
	"input_tp" : "-0.83",
	"input_lra" : "0.90",
	"input_thresh" : "-27.61",
	"output_i" : "-13.98",
	"output_tp" : "-1.51",
	"output_lra" : "1.00",
	"output_thresh" : "-24.16",
	"normalization_type" : "dynamic",
	"target_offset" : "-0.02"
}`

  it("вытаскивает измеренные значения из вывода ffmpeg", () => {
    expect(parseLoudnormMeasurement(stderr)).toEqual({
      inputI: "-17.42",
      inputTp: "-0.83",
      inputLra: "0.90",
      inputThresh: "-27.61",
      targetOffset: "-0.02",
    })
  })

  it("нет замера — null, а не выдуманные числа", () => {
    // Без замера второй проход обязан сойти на однопроходный режим, а не
    // подставить нули: нули означали бы «тишина» и вывернули бы громкость.
    expect(parseLoudnormMeasurement("")).toBeNull()
    expect(parseLoudnormMeasurement("ffmpeg version 7.1\nno json here")).toBeNull()
  })

  it("обрезанный JSON не притворяется замером", () => {
    expect(parseLoudnormMeasurement('{ "input_i" : "-17.42",')).toBeNull()
  })
})

describe("второй проход — применение", () => {
  const measured = {
    inputI: "-17.42",
    inputTp: "-0.83",
    inputLra: "0.90",
    inputThresh: "-27.61",
    targetOffset: "-0.02",
  }

  it("подставляет измеренное — это и делает проход точным", () => {
    const filter = buildLoudnormApplyFilter(measured)
    expect(filter).toContain("measured_I=-17.42")
    expect(filter).toContain("measured_TP=-0.83")
    expect(filter).toContain("measured_LRA=0.90")
    expect(filter).toContain("measured_thresh=-27.61")
    expect(filter).toContain("offset=-0.02")
    expect(filter).toContain("linear=true")
  })

  it("без замера отдаёт однопроходный вариант, а не ломается", () => {
    const filter = buildLoudnormApplyFilter(null)
    expect(filter).toContain("loudnorm")
    expect(filter).not.toContain("measured_I")
  })
})
