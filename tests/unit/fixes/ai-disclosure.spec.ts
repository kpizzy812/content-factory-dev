/**
 * Маркировка AI-контента при публикации.
 *
 * С 2 августа 2026 EU AI Act требует раскрытия AI-генерации для аудитории в EU,
 * включая площадки вне EU, работающие на эту аудиторию. У платформ для этого
 * есть штатные поля, и они разные:
 *   - TikTok Content Posting API — `post_info.is_aigc`;
 *   - YouTube Data API v3 — `status.containsSyntheticMedia` (с 30.10.2024);
 *   - Instagram Graph API поля не имеет — Meta размечает по метаданным файла.
 *
 * Наши ролики синтетические всегда: речь синтезирована, кадры сгенерированы,
 * ведущий бывает аватаром. Поэтому флаг не вычисляется из настроек, а
 * проставляется по факту производства.
 */

import { describe, expect, it } from "vitest"
import {
  AI_DISCLOSURE_UNSUPPORTED_PLATFORMS,
  buildAiDisclosure,
  supportsAiDisclosure,
} from "../../../server/utils/social/ai-disclosure"

describe("buildAiDisclosure", () => {
  it("TikTok получает is_aigc", () => {
    expect(buildAiDisclosure("tiktok", true)).toEqual({ is_aigc: true })
  })

  it("YouTube получает containsSyntheticMedia", () => {
    expect(buildAiDisclosure("youtube", true)).toEqual({ containsSyntheticMedia: true })
  })

  it("площадка без поля не получает выдуманного ключа", () => {
    // Отправить Instagram несуществующее поле — это отказ публикации на ровном
    // месте. Раскрытие там делается метаданными файла, а не параметром запроса.
    expect(buildAiDisclosure("instagram", true)).toEqual({})
  })

  it("выключенное раскрытие не подставляет false там, где поля нет", () => {
    expect(buildAiDisclosure("instagram", false)).toEqual({})
  })

  it("выключенное раскрытие передаётся явно там, где поле есть", () => {
    // Явный false — это утверждение «контент не синтетический». Пропуск поля
    // означал бы «не ответили», и площадка вправе решить сама.
    expect(buildAiDisclosure("tiktok", false)).toEqual({ is_aigc: false })
    expect(buildAiDisclosure("youtube", false)).toEqual({ containsSyntheticMedia: false })
  })
})

describe("supportsAiDisclosure", () => {
  it("знает, у каких площадок есть штатное поле", () => {
    expect(supportsAiDisclosure("tiktok")).toBe(true)
    expect(supportsAiDisclosure("youtube")).toBe(true)
    expect(supportsAiDisclosure("instagram")).toBe(false)
  })

  it("площадки без поддержки перечислены явно — оператор должен о них знать", () => {
    expect(AI_DISCLOSURE_UNSUPPORTED_PLATFORMS).toContain("instagram")
  })
})
