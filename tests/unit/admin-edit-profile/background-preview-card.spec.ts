/**
 * Карточка фона показывает сам фон.
 *
 * Долг §8.2 отчёта: превью не было, карточка рисовала иконку по типу. Теперь
 * список отдаёт `previewUrl`, но честность состояний терять нельзя — их три, и
 * ни одно не должно выглядеть пустой рамкой:
 *   1) ссылка есть и файл загрузился — видно фон;
 *   2) ссылки нет (сервер не смог её собрать) — сказано, что превью нет;
 *   3) ссылка есть, но браузер файл не показал (истёк токен, файл пропал) —
 *      сказано ровно это, а не «нет превью».
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  PREVIEW_FAILED_TEXT,
  PREVIEW_MISSING_TEXT,
  describeClipPreview,
} from "~~/app/components/admin/background-library-model"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

const base = {
  id: "clip-1",
  storageKey: "zavodcamp/apps/7/backgrounds/aaaa1111.mp4",
  kind: "footage",
  mimeType: "video/mp4",
  previewUrl: "https://storage.test/aaaa1111.mp4?signed=1",
}

describe("описание превью карточки", () => {
  it("видео показывается видео", () => {
    expect(describeClipPreview(base)).toEqual({ kind: "video", url: base.previewUrl })
  })

  it("картинка показывается картинкой", () => {
    expect(describeClipPreview({
      ...base,
      mimeType: "image/png",
      kind: "image",
      previewUrl: "https://storage.test/bbbb.png?signed=1",
    })).toEqual({ kind: "image", url: "https://storage.test/bbbb.png?signed=1" })
  })

  it("без mimeType решает тип клипа, а не догадка", () => {
    expect(describeClipPreview({ ...base, mimeType: null, kind: "image" }).kind).toBe("image")
    expect(describeClipPreview({ ...base, mimeType: null, kind: "screen_recording" }).kind).toBe("video")
  })

  it("ссылки нет — состояние честное, с причиной", () => {
    const preview = describeClipPreview({ ...base, previewUrl: null })
    expect(preview.kind).toBe("none")
    if (preview.kind !== "none") throw new Error("unreachable")
    expect(preview.reason).toBe(PREVIEW_MISSING_TEXT)
    expect(preview.reason.length).toBeGreaterThan(0)
  })

  it("поле previewUrl вовсе отсутствует (старый ответ сервера) — тоже честное «нет»", () => {
    const preview = describeClipPreview({ ...base, previewUrl: undefined })
    expect(preview.kind).toBe("none")
  })

  it("пустая строка ссылкой не считается", () => {
    expect(describeClipPreview({ ...base, previewUrl: "   " }).kind).toBe("none")
  })
})

describe("состояние «превью не получилось» в карточке", () => {
  const library = file("app/components/admin/AppBackgroundLibrary.vue")

  it("превью рисуется по разбору, а не по наличию строки в поле", () => {
    expect(library).toContain("describeClipPreview")
    expect(library).toContain("<video")
    expect(library).toContain("<img")
  })

  it("сбой загрузки файла в браузере переводит карточку в честное состояние", () => {
    // Без обработчика ошибки карточка осталась бы пустой рамкой: элемент есть,
    // файла в нём нет, и оператор снова выбирает фон вслепую. Обработчик нужен
    // ОБОИМ элементам — и видео, и картинке: сломанное видео и сломанная
    // картинка выглядят одинаково пусто.
    const handlers = library.match(/@error="onPreviewError\(clip\.id\)"/g) ?? []
    expect(handlers.length).toBeGreaterThanOrEqual(2)
    expect(library).toContain("previewFailed")
    expect(library).toContain("PREVIEW_FAILED_TEXT")
  })

  it("причина «нет ссылки» показывается текстом, а не только иконкой", () => {
    expect(library).toContain("preview.reason")
  })

  it("старая заглушка «превью нет по-честному» из карточки убрана", () => {
    expect(library).not.toContain("Превью нет по-честному")
  })
})

describe("тип ответа списка фонов знает про ссылку", () => {
  it("BackgroundClip несёт previewUrl", () => {
    const types = file("shared/types/edit-console.ts")
    expect(types).toContain("previewUrl")
  })
})
