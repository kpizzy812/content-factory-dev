/**
 * Unit-тесты validateYoutubeSnapshot — fail-safe валидация на edge POST /api/posting-jobs.
 *
 * Принципы:
 *   - title обязателен (1..100)
 *   - description ≤5000 (опц.)
 *   - hashtags string[], суммарно ≤500 chars (опц.)
 *   - youtube.visibility обязателен (без дефолта — fail-safe)
 *   - youtube.madeForKids обязателен boolean (без дефолта — YouTube требует выбор)
 */
import { describe, it, expect } from "vitest"
import {
  validateYoutubeSnapshot,
  YoutubeSnapshotValidationError,
  YOUTUBE_TITLE_MAX,
  YOUTUBE_DESCRIPTION_MAX,
  YOUTUBE_HASHTAGS_TOTAL_MAX,
} from "../../server/utils/posting/youtube-snapshot-validator"

function validBase() {
  return {
    title: "Test video",
    description: "Some description",
    hashtags: ["tag1", "tag2"],
    youtube: {
      visibility: "private",
      madeForKids: false,
    },
  }
}

describe("validateYoutubeSnapshot", () => {
  it("валидный snapshot проходит без ошибок", () => {
    expect(() => validateYoutubeSnapshot(validBase())).not.toThrow()
  })

  it("title отсутствует → ошибка", () => {
    const snap = { ...validBase() } as Record<string, unknown>
    delete snap.title
    expect(() => validateYoutubeSnapshot(snap)).toThrow(
      YoutubeSnapshotValidationError,
    )
  })

  it("title пустая строка → ошибка", () => {
    const snap = { ...validBase(), title: "   " }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(/title обязателен/)
  })

  it(`title >${YOUTUBE_TITLE_MAX} chars → ошибка`, () => {
    const snap = { ...validBase(), title: "x".repeat(YOUTUBE_TITLE_MAX + 1) }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(
      new RegExp(`превышает лимит ${YOUTUBE_TITLE_MAX}`),
    )
  })

  it("description опционален — отсутствие не валит", () => {
    const snap = { ...validBase() } as Record<string, unknown>
    delete snap.description
    expect(() => validateYoutubeSnapshot(snap)).not.toThrow()
  })

  it(`description >${YOUTUBE_DESCRIPTION_MAX} chars → ошибка`, () => {
    const snap = {
      ...validBase(),
      description: "x".repeat(YOUTUBE_DESCRIPTION_MAX + 1),
    }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(
      new RegExp(`description превышает лимит ${YOUTUBE_DESCRIPTION_MAX}`),
    )
  })

  it("hashtags не массив → ошибка", () => {
    const snap = { ...validBase(), hashtags: "tag1,tag2" }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(/hashtags должен быть массивом/)
  })

  it("hashtags содержит не-строку → ошибка", () => {
    const snap = { ...validBase(), hashtags: ["ok", 123] }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(/только строки/)
  })

  it(`hashtags суммарно >${YOUTUBE_HASHTAGS_TOTAL_MAX} chars → ошибка`, () => {
    const snap = {
      ...validBase(),
      hashtags: ["x".repeat(YOUTUBE_HASHTAGS_TOTAL_MAX)],
    }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(
      /суммарная длина hashtags превышает/,
    )
  })

  it("youtube объект отсутствует → ошибка", () => {
    const snap = { ...validBase() } as Record<string, unknown>
    delete snap.youtube
    expect(() => validateYoutubeSnapshot(snap)).toThrow(
      /youtube обязателен/,
    )
  })

  it("youtube.visibility отсутствует → ошибка (НЕТ ДЕФОЛТА — fail-safe)", () => {
    const snap = {
      ...validBase(),
      youtube: { madeForKids: false },
    }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(/visibility обязателен/)
  })

  it("youtube.visibility не из enum → ошибка", () => {
    const snap = {
      ...validBase(),
      youtube: { visibility: "secret", madeForKids: false },
    }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(/visibility обязателен/)
  })

  it("youtube.madeForKids отсутствует → ошибка (НЕТ ДЕФОЛТА — YouTube требует выбор)", () => {
    const snap = {
      ...validBase(),
      youtube: { visibility: "private" },
    }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(/madeForKids обязателен/)
  })

  it("youtube.madeForKids строка → ошибка (только boolean)", () => {
    const snap = {
      ...validBase(),
      youtube: { visibility: "private", madeForKids: "false" },
    }
    expect(() => validateYoutubeSnapshot(snap)).toThrow(/boolean/)
  })

  it.each(["public", "unlisted", "private"])(
    "visibility=%s — все три значения валидны",
    (v) => {
      const snap = {
        ...validBase(),
        youtube: { visibility: v, madeForKids: false },
      }
      expect(() => validateYoutubeSnapshot(snap)).not.toThrow()
    },
  )
})
