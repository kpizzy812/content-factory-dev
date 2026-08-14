/**
 * Нарезанный фрагмент обязан лезть в модель по кадру.
 *
 * `kwaivgi/kling-lip-sync` принимает 720-1080 по ширине и 720-1920 по высоте
 * (LIP_SYNC_CONSTRAINTS), а телефон снимает 4K: после поворота это 2160x3840.
 * Фрагмент, нарезанный «как в исходнике», модель отвергнет — и узнаем мы об
 * этом на первом же платном прогоне, уже наполнив библиотеку негодным.
 *
 * Заодно ограничение в 100 МБ на файл: 4K60 набирает его за несколько секунд.
 */

import { describe, expect, it } from "vitest"

import { buildPresenterCutArgs } from "~~/server/utils/presenter/ffmpeg-adapter"

function filterOf(args: readonly string[]): string {
  const index = args.indexOf("-vf")
  expect(index).toBeGreaterThan(-1)
  return args[index + 1] ?? ""
}

describe("аргументы нарезки фрагмента", () => {
  const args = buildPresenterCutArgs("/tmp/take.mov", 12.5, 6.25, "/tmp/out/clip-001.mp4")

  it("вписывает кадр в 1080x1920 с сохранением пропорций", () => {
    const filter = filterOf(args)
    expect(filter).toContain("1080")
    expect(filter).toContain("1920")
    // Именно вписать, а не растянуть: растяжение изменило бы лицо.
    expect(filter).toContain("force_original_aspect_ratio=decrease")
  })

  it("приводит стороны к чётным — иначе yuv420p не кодируется", () => {
    expect(filterOf(args)).toContain("trunc(iw/2)*2")
  })

  it("срезает частоту кадров: 60 к/с в исходнике удваивают вес файла", () => {
    expect(args).toContain("-r")
    expect(Number(args[args.indexOf("-r") + 1])).toBeLessThanOrEqual(30)
  })

  it("ищет до -i: быстрый поиск, иначе десятиминутная запись читается целиком", () => {
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"))
    expect(args[args.indexOf("-ss") + 1]).toBe("12.50")
  })

  it("длительность задаётся -t после входа, выход идёт последним", () => {
    expect(args.indexOf("-t")).toBeGreaterThan(args.indexOf("-i"))
    expect(args[args.indexOf("-t") + 1]).toBe("6.25")
    expect(args[args.length - 1]).toBe("/tmp/out/clip-001.mp4")
  })

  it("перекодирует, а не копирует поток", () => {
    // `-c copy` выравнивается по ключевым кадрам и даёт клип не той длины,
    // а модель принимает строго 2-10 секунд.
    expect(args).toContain("libx264")
    expect(args).not.toContain("copy")
  })
})
