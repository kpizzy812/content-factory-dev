/**
 * Unit-тесты pure helpers worker'а: detectIsShorts + parseYoutubeSnapshot.
 *
 * detectIsShorts критичен для YouTube — определяет добавление #Shorts и
 * правильную нормализацию URL (/shorts/<id> vs /watch?v=<id>).
 *
 * parseYoutubeSnapshot валидирует структуру contentSnapshot повторно
 * на стороне worker (defence-in-depth: если кто-то создал job минуя API).
 */
import { describe, expect, it } from "vitest"

import {
  detectIsShorts,
  parseYoutubeSnapshot,
} from "../../server/utils/posting/worker"

describe("detectIsShorts", () => {
  it("portrait + duration=30 → true", () => {
    expect(detectIsShorts({ format: "portrait", duration: 30 })).toBe(true)
  })

  it("portrait + duration=59 → true (граница включительно)", () => {
    expect(detectIsShorts({ format: "portrait", duration: 59 })).toBe(true)
  })

  it("portrait + duration=60 → false (равно — НЕ shorts)", () => {
    expect(detectIsShorts({ format: "portrait", duration: 60 })).toBe(false)
  })

  it("landscape + duration=30 → false", () => {
    expect(detectIsShorts({ format: "landscape", duration: 30 })).toBe(false)
  })

  it("portrait + duration=null → false (consistent: без длительности не shorts)", () => {
    expect(detectIsShorts({ format: "portrait", duration: null })).toBe(false)
  })

  it("portrait + duration=0 → false", () => {
    expect(detectIsShorts({ format: "portrait", duration: 0 })).toBe(false)
  })
})

describe("parseYoutubeSnapshot", () => {
  it("валидный snapshot → правильная структура", () => {
    const result = parseYoutubeSnapshot({
      title: "Hello",
      description: "World",
      hashtags: ["fun", "viral"],
      youtube: { visibility: "private", madeForKids: false },
    })
    expect(result).toEqual({
      title: "Hello",
      description: "World",
      hashtags: ["fun", "viral"],
      youtube: { visibility: "private", madeForKids: false },
    })
  })

  it("title отсутствует → throws", () => {
    expect(() =>
      parseYoutubeSnapshot({
        youtube: { visibility: "private", madeForKids: false },
      }),
    ).toThrow(/title обязателен/)
  })

  it("visibility отсутствует → throws (НЕТ ДЕФОЛТА)", () => {
    expect(() =>
      parseYoutubeSnapshot({
        title: "x",
        youtube: { madeForKids: false },
      }),
    ).toThrow(/visibility обязателен/)
  })

  it("visibility не из enum → throws", () => {
    expect(() =>
      parseYoutubeSnapshot({
        title: "x",
        youtube: { visibility: "secret", madeForKids: false },
      }),
    ).toThrow(/visibility обязателен/)
  })

  it("madeForKids отсутствует → throws (НЕТ ДЕФОЛТА)", () => {
    expect(() =>
      parseYoutubeSnapshot({
        title: "x",
        youtube: { visibility: "private" },
      }),
    ).toThrow(/madeForKids обязателен/)
  })

  it("hashtags пустой массив → допускается (пустой результат)", () => {
    const result = parseYoutubeSnapshot({
      title: "x",
      hashtags: [],
      youtube: { visibility: "unlisted", madeForKids: true },
    })
    expect(result.hashtags).toEqual([])
  })

  it("description опциональна → пустая строка", () => {
    const result = parseYoutubeSnapshot({
      title: "x",
      youtube: { visibility: "private", madeForKids: false },
    })
    expect(result.description).toBe("")
  })

  it("hashtags содержит не-строки → фильтрует", () => {
    const result = parseYoutubeSnapshot({
      title: "x",
      hashtags: ["ok", 123, null, "good"],
      youtube: { visibility: "private", madeForKids: false },
    })
    expect(result.hashtags).toEqual(["ok", "good"])
  })
})
