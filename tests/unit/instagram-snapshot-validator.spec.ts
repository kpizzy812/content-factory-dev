/**
 * Unit-тесты validateInstagramSnapshot — fail-safe валидация на edge
 * POST /api/posting-jobs + bulk.
 *
 * Особенности IG (vs YouTube):
 *   - caption опционален, но caption + хэштеги (конкатенация) ≤ 2200 (одно поле)
 *   - hashtags ≤ 30 шт, каждый без пробелов
 *   - НЕТ visibility / madeForKids
 */
import { describe, it, expect } from "vitest"
import {
  validateInstagramSnapshot,
  InstagramSnapshotValidationError,
} from "../../server/utils/posting/instagram-snapshot-validator"
import {
  INSTAGRAM_CAPTION_MAX,
  INSTAGRAM_HASHTAGS_MAX_COUNT,
} from "../../shared/types/posting-instagram"

describe("validateInstagramSnapshot", () => {
  it("валидный snapshot проходит без ошибок", () => {
    expect(() =>
      validateInstagramSnapshot({
        caption: "Привет, Reels! 🎬",
        hashtags: ["reels", "viral"],
        instagram: { shareAsReel: true },
      }),
    ).not.toThrow()
  })

  it("пустой snapshot (caption опционален) проходит", () => {
    expect(() => validateInstagramSnapshot({})).not.toThrow()
  })

  it("caption не строка → ошибка", () => {
    expect(() => validateInstagramSnapshot({ caption: 123 })).toThrow(
      InstagramSnapshotValidationError,
    )
  })

  it(`caption ровно ${INSTAGRAM_CAPTION_MAX} без тегов — ОК`, () => {
    expect(() =>
      validateInstagramSnapshot({ caption: "x".repeat(INSTAGRAM_CAPTION_MAX) }),
    ).not.toThrow()
  })

  it(`caption > ${INSTAGRAM_CAPTION_MAX} → ошибка`, () => {
    expect(() =>
      validateInstagramSnapshot({ caption: "x".repeat(INSTAGRAM_CAPTION_MAX + 1) }),
    ).toThrow(/превышает лимит/)
  })

  it("caption + конкатенация хэштегов учитываются вместе (≤2200)", () => {
    // caption 2190 + тег "#viral" (6) + пробел (1) = 2197 ≤ 2200 — ОК
    expect(() =>
      validateInstagramSnapshot({
        caption: "x".repeat(2190),
        hashtags: ["viral"],
      }),
    ).not.toThrow()
  })

  it("caption + хэштеги суммарно > 2200 → ошибка (одно поле в IG)", () => {
    // caption 2200 + любой тег → > 2200
    expect(() =>
      validateInstagramSnapshot({
        caption: "x".repeat(INSTAGRAM_CAPTION_MAX),
        hashtags: ["overflow"],
      }),
    ).toThrow(/caption вместе с хэштегами превышает/)
  })

  it(`ровно ${INSTAGRAM_HASHTAGS_MAX_COUNT} тегов — ОК`, () => {
    const tags = Array.from({ length: INSTAGRAM_HASHTAGS_MAX_COUNT }, (_, i) => `tag${i}`)
    expect(() => validateInstagramSnapshot({ caption: "hi", hashtags: tags })).not.toThrow()
  })

  it(`> ${INSTAGRAM_HASHTAGS_MAX_COUNT} тегов → ошибка`, () => {
    const tags = Array.from(
      { length: INSTAGRAM_HASHTAGS_MAX_COUNT + 1 },
      (_, i) => `tag${i}`,
    )
    expect(() => validateInstagramSnapshot({ hashtags: tags })).toThrow(
      /число хэштегов превышает лимит/,
    )
  })

  it("хэштег с пробелом → ошибка", () => {
    expect(() =>
      validateInstagramSnapshot({ hashtags: ["valid", "not valid"] }),
    ).toThrow(/содержит пробел/)
  })

  it("hashtags не массив → ошибка", () => {
    expect(() => validateInstagramSnapshot({ hashtags: "tag1,tag2" })).toThrow(
      /должен быть массивом/,
    )
  })

  it("hashtags с не-строкой → ошибка", () => {
    expect(() => validateInstagramSnapshot({ hashtags: ["ok", 7] })).toThrow(
      /только строки/,
    )
  })

  it("instagram.shareAsReel не boolean → ошибка", () => {
    expect(() =>
      validateInstagramSnapshot({ instagram: { shareAsReel: "yes" } }),
    ).toThrow(/shareAsReel должен быть boolean/)
  })

  it("instagram namespace опционален — отсутствие не валит", () => {
    expect(() => validateInstagramSnapshot({ caption: "hi" })).not.toThrow()
  })
})
