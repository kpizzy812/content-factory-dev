/**
 * Дедуп по первому кадру не годится для непрерывной съёмки.
 *
 * Измерено на реальной записи ведущей (10 минут, один дубль, один фон):
 * резка по паузам дала 106 фрагментов, дедуп по dHash первого кадра оставил
 * **6**. Понижение порога не помогает — на 4 битах остаётся 10. Причина в самом
 * сигнале: dHash сжимает кадр до 9x8 серых пикселей, а у говорящей головы на
 * статичном фоне все кадры в этом разрешении одинаковы. Разные фразы и жесты
 * туда просто не попадают.
 *
 * При этом фрагменты РАЗНЫЕ: их границы — паузы между репликами. Отбрасывать их
 * значит выкидывать 94% отснятого материала.
 *
 * Точный повтор (та же запись, залитая дважды) ловится не хешом, а
 * `@@unique([characterId, sha1])` в схеме — там он и остаётся.
 */

import { describe, expect, it, vi } from "vitest"

import { ingestPresenterRecording } from "~~/server/utils/presenter/ingest-runner"
import { DHASH_HEIGHT, DHASH_WIDTH } from "~~/server/utils/presenter/perceptual-hash"

/** Один и тот же кадр на все фрагменты — ровно случай статичной съёмки. */
function sameFrame(): Uint8Array {
  const pixels = new Uint8Array(DHASH_WIDTH * DHASH_HEIGHT)
  let state = 42
  for (let i = 0; i < pixels.length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648
    pixels[i] = state % 256
  }
  return pixels
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    probeDuration: vi.fn(async () => 20),
    detectScenes: vi.fn(async () => [10]),
    detectSilence: vi.fn(async () => [10]),
    cutSegment: vi.fn(async () => {}),
    grayscaleThumbnail: vi.fn(async () => sameFrame()),
    ...overrides,
  }
}

const input = { recordingPath: "/tmp/take.mov", outputDir: "/tmp/out" }

describe("резка по паузам не отбрасывает похожие кадры", () => {
  it("оба фрагмента приняты, хотя первый кадр у них одинаковый", async () => {
    const result = await ingestPresenterRecording(input, deps() as never)

    expect(result.boundarySource).toBe("silence")
    expect(result.clips).toHaveLength(2)
    expect(result.skipped).toHaveLength(0)
  })

  it("но похожесть посчитана и видна в отчёте", async () => {
    // Молча игнорировать нельзя: если материал реально дублируется, оператор
    // должен это увидеть, а не гадать, почему ролики похожи.
    const result = await ingestPresenterRecording(input, deps() as never)

    expect(result.similarClips).toBe(1)
  })

  it("похожее на уже лежащее в библиотеке тоже не отбрасывается", async () => {
    const known = await ingestPresenterRecording(input, deps() as never)
    const result = await ingestPresenterRecording(
      { ...input, existingHashes: [known.clips[0]!.perceptualHash] },
      deps() as never,
    )

    expect(result.clips).toHaveLength(2)
    expect(result.similarClips).toBe(2)
  })

  it("явный dropSimilarClips возвращает жёсткий отбор", async () => {
    const result = await ingestPresenterRecording(
      { ...input, dropSimilarClips: true },
      deps() as never,
    )

    expect(result.clips).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe("duplicate")
  })
})

describe("резка по склейкам сохраняет прежний отбор", () => {
  it("на монтажной записи похожий фрагмент по-прежнему отбрасывается", async () => {
    // Там, где границы дали настоящие склейки, одинаковый первый кадр означает
    // повтор сцены — сигнал работает, и трогать его незачем.
    const result = await ingestPresenterRecording(
      input,
      deps({ detectSilence: vi.fn(async () => []) }) as never,
    )

    expect(result.boundarySource).toBe("scene")
    expect(result.clips).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe("duplicate")
  })
})
