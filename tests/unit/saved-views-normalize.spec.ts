import { beforeAll, describe, expect, it } from "vitest"

/**
 * Нормализаторы сохранённых представлений. Тело представления приходит с
 * клиента и уходит в JSONB, поэтому проверяем именно то, что туда не попадёт
 * лишнего: вложенных объектов, функций и пустых значений.
 *
 * createError — автоимпорт Nitro; в node-окружении его нет, подставляем
 * совместимую заглушку до импорта модуля.
 */
let mod: typeof import("../../server/utils/saved-views")

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).createError = (opts: { statusCode: number, message: string }) => {
    const err = new Error(opts.message) as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  }
  mod = await import("../../server/utils/saved-views")
})

describe("раздел представления", () => {
  it("принимает нормальные слаги и приводит к нижнему регистру", () => {
    expect(mod.normalizeSection("trends")).toBe("trends")
    expect(mod.normalizeSection(" Posting-Jobs ")).toBe("posting-jobs")
  })

  it("отсекает мусор, который засорил бы ключи разделов", () => {
    for (const bad of ["", "a", "1trends", "trends/../admin", "тренды", null, 42]) {
      expect(() => mod.normalizeSection(bad), String(bad)).toThrow()
    }
  })
})

describe("название", () => {
  it("обрезает по лимиту, а не отвергает", () => {
    expect(mod.normalizeName("x".repeat(200))).toHaveLength(60)
  })

  it("пустое имя — ошибка: вкладку без подписи не выбрать", () => {
    expect(() => mod.normalizeName("   ")).toThrow()
    expect(() => mod.normalizeName(undefined)).toThrow()
  })
})

describe("параметры фильтра", () => {
  it("оставляет только плоские значения", () => {
    const out = mod.normalizeQuery({
      platform: "tiktok",
      page: 3,
      onlyMine: true,
      tags: ["a", "b"],
    })
    expect(out).toEqual({ platform: "tiktok", page: 3, onlyMine: true, tags: ["a", "b"] })
  })

  it("выбрасывает пустые значения — они ничего не фильтруют", () => {
    expect(mod.normalizeQuery({ status: "", geo: null, lang: undefined, ok: "да" }))
      .toEqual({ ok: "да" })
  })

  it("не пускает вложенные объекты и функции в JSONB", () => {
    const out = mod.normalizeQuery({
      nested: { a: 1 },
      mixed: ["a", 1],
      fn: () => null,
      good: "x",
    })
    expect(out).toEqual({ good: "x" })
  })

  it("тело обязательно", () => {
    expect(() => mod.normalizeQuery(null)).toThrow()
    expect(() => mod.normalizeQuery([])).toThrow()
  })
})

describe("колонки", () => {
  it("оставляет строки и режет длинный список", () => {
    expect(mod.normalizeColumns(["title", 1, "status", null])).toEqual(["title", "status"])
    expect(mod.normalizeColumns(Array.from({ length: 100 }, (_, i) => `c${i}`))).toHaveLength(40)
  })

  it("отсутствие колонок — это null, а не пустой список", () => {
    expect(mod.normalizeColumns(undefined)).toBeNull()
    expect(mod.normalizeColumns("title")).toBeNull()
  })
})

describe("класс представления", () => {
  it("всё, что не shared, считается личным", () => {
    expect(mod.normalizeScope("shared")).toBe("shared")
    expect(mod.normalizeScope("personal")).toBe("personal")
    expect(mod.normalizeScope("system")).toBe("personal")
    expect(mod.normalizeScope(undefined)).toBe("personal")
  })
})

describe("право на общие представления", () => {
  it("временно завязано на canAdmin — MarketingCamp отдельный флаг не отдаёт", () => {
    expect(mod.canManageSharedViews({ canAdmin: true })).toBe(true)
    expect(mod.canManageSharedViews({ canAdmin: false })).toBe(false)
    expect(mod.canManageSharedViews(null)).toBe(false)
    expect(mod.canManageSharedViews(undefined)).toBe(false)
  })
})
