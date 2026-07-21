/**
 * Unit-тесты UI-контракта Instagram-постинга (PR6).
 *
 * Доказываем, что contentSnapshot, который собирают модалки PostingJobCreateModal
 * и PostingJobBulkCreateModal через buildInstagramContentSnapshot, ровно
 * совпадает с тем, что ждёт серверный validateInstagramSnapshot. Это страховка
 * от дрейфа клиент↔бэк (если кто-то поменяет форму snapshot с одной стороны).
 */
import { describe, it, expect } from "vitest"
import {
  buildInstagramContentSnapshot,
  computeInstagramCaptionLength,
  INSTAGRAM_CAPTION_MAX,
  INSTAGRAM_HASHTAGS_MAX_COUNT,
} from "../../shared/types/posting-instagram"
import {
  validateInstagramSnapshot,
  InstagramSnapshotValidationError,
} from "../../server/utils/posting/instagram-snapshot-validator"

describe("Instagram UI snapshot ↔ server validator (контракт PR6)", () => {
  it("builder выдаёт {caption, hashtags, instagram:{shareAsReel:true}}", () => {
    const snap = buildInstagramContentSnapshot({
      caption: "Привет, Reels! 🎬",
      hashtags: ["reels", "viral"],
    })
    expect(snap).toEqual({
      caption: "Привет, Reels! 🎬",
      hashtags: ["reels", "viral"],
      instagram: { shareAsReel: true },
    })
  })

  it("snapshot из builder проходит серверную валидацию", () => {
    const snap = buildInstagramContentSnapshot({
      caption: "Текст поста",
      hashtags: ["fitness", "motivation", "reels"],
    })
    expect(() =>
      validateInstagramSnapshot(snap as Record<string, unknown>),
    ).not.toThrow()
  })

  it("пустой caption → caption опускается, shareAsReel остаётся", () => {
    const snap = buildInstagramContentSnapshot({ caption: "   ", hashtags: [] })
    expect(snap.caption).toBeUndefined()
    expect(snap.hashtags).toBeUndefined()
    expect(snap.instagram).toEqual({ shareAsReel: true })
    expect(() =>
      validateInstagramSnapshot(snap as Record<string, unknown>),
    ).not.toThrow()
  })

  it("UI-счётчик и серверный лимит используют одну формулу длины", () => {
    // На границе ровно 2200 — валидно; +1 — серверная ошибка.
    const tags = ["a", "b"] // " #a #b" = 6 символов сверх caption
    const tagsLen = computeInstagramCaptionLength("", tags) // длина "#a #b"
    const fillLen = INSTAGRAM_CAPTION_MAX - tagsLen - 1 // -1 за разделитель caption↔теги
    const caption = "x".repeat(fillLen)

    const atLimit = computeInstagramCaptionLength(caption, tags)
    expect(atLimit).toBe(INSTAGRAM_CAPTION_MAX)
    expect(() =>
      validateInstagramSnapshot(
        buildInstagramContentSnapshot({
          caption,
          hashtags: tags,
        }) as Record<string, unknown>,
      ),
    ).not.toThrow()

    // Превышение — серверный валидатор бракует (UI блокирует submit аналогично).
    const overCaption = caption + "y"
    expect(computeInstagramCaptionLength(overCaption, tags)).toBeGreaterThan(
      INSTAGRAM_CAPTION_MAX,
    )
    expect(() =>
      validateInstagramSnapshot(
        buildInstagramContentSnapshot({
          caption: overCaption,
          hashtags: tags,
        }) as Record<string, unknown>,
      ),
    ).toThrow(InstagramSnapshotValidationError)
  })

  it("хэштег с пробелом бракуется сервером (контракт-полнота)", () => {
    // UI-парсер parseHashtagsInput такого не пропустит (он сплитит по пробелам),
    // но прямой контракт билдер↔валидатор должен быть зафиксирован: если в
    // hashtags попал тег с пробелом — сервер его отклоняет.
    const snap = buildInstagramContentSnapshot({
      caption: "ok",
      hashtags: ["with space"],
    })
    expect(snap.hashtags).toEqual(["with space"])
    expect(() =>
      validateInstagramSnapshot(snap as Record<string, unknown>),
    ).toThrow(InstagramSnapshotValidationError)
  })

  it("превышение лимита хэштегов бракуется сервером", () => {
    const tags = Array.from(
      { length: INSTAGRAM_HASHTAGS_MAX_COUNT + 1 },
      (_, i) => `t${i}`,
    )
    expect(() =>
      validateInstagramSnapshot(
        buildInstagramContentSnapshot({
          caption: "ok",
          hashtags: tags,
        }) as Record<string, unknown>,
      ),
    ).toThrow(InstagramSnapshotValidationError)
  })
})
