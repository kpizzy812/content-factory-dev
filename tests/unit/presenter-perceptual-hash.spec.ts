import { describe, expect, it } from "vitest"

import {
  DHASH_HEIGHT,
  DHASH_WIDTH,
  areFramesSimilar,
  dHashFromGrayscale,
  hammingDistance,
} from "~~/server/utils/presenter/perceptual-hash"

/** Кадр 9x8 из функции яркости — удобно строить предсказуемые примеры. */
function frame(fn: (x: number, y: number) => number): Uint8Array {
  const pixels = new Uint8Array(DHASH_WIDTH * DHASH_HEIGHT)
  for (let y = 0; y < DHASH_HEIGHT; y += 1) {
    for (let x = 0; x < DHASH_WIDTH; x += 1) {
      pixels[y * DHASH_WIDTH + x] = Math.max(0, Math.min(255, Math.round(fn(x, y))))
    }
  }
  return pixels
}

describe("perceptual hash", () => {
  it("даёт 64-битный хеш в 16 hex-символах", () => {
    const hash = dHashFromGrayscale(frame((x, y) => x * 20 + y))
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it("одинаковые кадры дают одинаковый хеш", () => {
    const build = () => frame((x, y) => x * 11 + y * 3)
    expect(dHashFromGrayscale(build())).toBe(dHashFromGrayscale(build()))
    expect(hammingDistance(dHashFromGrayscale(build()), dHashFromGrayscale(build()))).toBe(0)
  })

  it("не реагирует на равномерное изменение яркости", () => {
    const dark = dHashFromGrayscale(frame((x, y) => 20 + x * 10 + y))
    const bright = dHashFromGrayscale(frame((x, y) => 90 + x * 10 + y))
    expect(dark).toBe(bright)
  })

  it("различает разное содержимое кадра", () => {
    const rising = dHashFromGrayscale(frame(x => x * 25))
    const falling = dHashFromGrayscale(frame(x => 255 - x * 25))
    expect(rising).not.toBe(falling)
    expect(hammingDistance(rising, falling)).toBeGreaterThan(16)
  })

  it("считает расстояние Хэмминга по битам", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0)
    expect(hammingDistance("0000000000000001", "0000000000000000")).toBe(1)
    expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64)
    expect(hammingDistance("00000000000000ff", "0000000000000000")).toBe(8)
  })

  it("отвергает вход неверного размера или формата", () => {
    expect(() => dHashFromGrayscale(new Uint8Array(10))).toThrow(/9x8/)
    expect(() => hammingDistance("zz", "0000000000000000")).toThrow(/hex/)
    expect(() => hammingDistance("ffffffffffffffff", "abc")).toThrow(/hex/)
  })

  it("считает похожими кадры в пределах порога", () => {
    const base = "ffffffffffffffff"
    expect(areFramesSimilar(base, "fffffffffffffffe", 6)).toBe(true)
    expect(areFramesSimilar(base, "0000000000000000", 6)).toBe(false)
    // Порог по умолчанию: подряд снятые кадры одной сцены считаются дублем.
    expect(areFramesSimilar(base, "fffffffffffffff0")).toBe(true)
  })
})
