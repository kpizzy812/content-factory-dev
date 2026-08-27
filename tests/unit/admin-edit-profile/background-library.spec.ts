import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  BACKGROUND_ACCEPT_MIME,
  BACKGROUND_MAX_BYTES,
  clipTitle,
  describeBackgroundUpload,
  formatClipDuration,
  summarizeLibrary,
  validateBackgroundFile,
} from "~~/app/components/admin/background-library-model"
import { BackgroundFileRejectedError, uploadBackgroundClip } from "~~/app/components/admin/background-library-client"
import type { AdminFetcher } from "~~/app/components/admin/edit-profile-client"
import type { BackgroundClip } from "~~/shared/types/edit-console"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

function clip(patch: Partial<BackgroundClip> = {}): BackgroundClip {
  return {
    id: "clip_1",
    appId: 3,
    name: "Экран онбординга",
    storageKey: "apps/3/backgrounds/abc.mp4",
    sha1: "abc",
    mimeType: "video/mp4",
    bytes: 18 * 1024 * 1024,
    durationSec: 12,
    width: 1080,
    height: 1920,
    kind: "screen_recording",
    tags: [],
    isActive: true,
    usageCount: 7,
    lastUsedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  }
}

describe("ограничения файла совпадают с серверными", () => {
  const store = file("server/utils/edit-plan/background-store.ts")

  it("список форматов — тот же, что в ALLOWED_BACKGROUND_MIME", () => {
    for (const mime of BACKGROUND_ACCEPT_MIME) {
      expect(store, mime).toContain(`"${mime}":`)
    }
    // И наоборот: сервер не принимает ничего сверх этого списка.
    const serverMimes = [...store.matchAll(/^ {2}"([a-z]+\/[a-z0-9.+-]+)":/gm)].map(m => m[1]!)
    expect(serverMimes.sort()).toEqual([...BACKGROUND_ACCEPT_MIME].sort())
  })

  it("потолок размера — те же 500 МБ", () => {
    expect(store).toContain("BACKGROUND_CLIP_MAX_BYTES = 500 * 1024 * 1024")
    expect(BACKGROUND_MAX_BYTES).toBe(500 * 1024 * 1024)
  })
})

describe("проверка файла до отправки", () => {
  it("пропускает поддержанный формат", () => {
    expect(validateBackgroundFile({ name: "screen.mp4", type: "video/mp4", size: 1024 })).toBeNull()
  })

  it("отвергает чужой формат словами, а не кодом 415", () => {
    const message = validateBackgroundFile({ name: "clip.avi", type: "video/x-msvideo", size: 1024 })
    expect(message).toContain("не поддерживается")
    expect(message).toContain("MP4")
  })

  it("отдельно объясняет нераспознанный браузером формат", () => {
    expect(validateBackgroundFile({ name: "clip", type: "", size: 1024 })).toContain("не определил формат")
  })

  it("отвергает файл больше потолка", () => {
    const message = validateBackgroundFile({ name: "big.mp4", type: "video/mp4", size: BACKGROUND_MAX_BYTES + 1 })
    expect(message).toContain("500 МБ")
  })
})

describe("тяжёлый файл не уходит в сеть", () => {
  it("500 МБ+ отклоняются до запроса", async () => {
    const mock = vi.fn(async () => ({ data: {} }))
    const fetcher = mock as unknown as AdminFetcher
    const oversized = { name: "big.mp4", type: "video/mp4", size: BACKGROUND_MAX_BYTES + 1 } as unknown as File

    await expect(uploadBackgroundClip(fetcher, 3, { file: oversized }))
      .rejects.toBeInstanceOf(BackgroundFileRejectedError)

    expect(mock).not.toHaveBeenCalled()
  })

  it("поддержанный файл уходит на ручку приложения методом POST", async () => {
    const calls: Array<{ url: string, options?: { method?: string, body?: unknown } }> = []
    const mock = vi.fn(async (url: string, options?: { method?: string, body?: unknown }) => {
      calls.push({ url, options })
      return { data: { clip: clip(), deduped: false, similarClipIds: [] } }
    })
    const fetcher = mock as unknown as AdminFetcher
    const accepted = { name: "screen.mp4", type: "video/mp4", size: 2048 } as unknown as File

    await uploadBackgroundClip(fetcher, 3, { file: accepted, tags: "онбординг" })

    expect(calls[0]!.url).toBe("/api/apps/3/background-clips")
    expect(calls[0]!.options?.method).toBe("POST")
    // Multipart, а не JSON: ручка читает `readMultipartFormData`.
    expect(calls[0]!.options?.body).toBeInstanceOf(FormData)
  })
})

describe("дубль показан как дубль, а не как успех", () => {
  const existing = clip({ id: "clip_1", name: "Экран онбординга" })
  const context = { knownClipIds: ["clip_1"], clipsById: { clip_1: existing } }

  it("байт-в-байт совпавший файл", () => {
    const notice = describeBackgroundUpload(
      { clip: existing, deduped: true, similarClipIds: [] },
      context,
    )
    expect(notice.tone).not.toBe("success")
    expect(notice.text).toContain("уже был в библиотеке байт в байт")
    expect(notice.text).toContain("новая запись не создана")
  })

  it("повторная заливка ранее погашенного фона названа возвратом, а не дублем", () => {
    // Сервер отвечает `deduped: true` и в этом случае тоже, но для оператора
    // это другое событие: фон вернулся в список, а не «ничего не изменилось».
    const notice = describeBackgroundUpload(
      { clip: clip({ id: "clip_9", name: "Склад" }), deduped: true, similarClipIds: [] },
      context,
    )
    expect(notice.text).toContain("погашенным")
    expect(notice.text).toContain("вернулся в список")
  })

  it("похожий по первому кадру помечен и назван по именам, а не по id", () => {
    const notice = describeBackgroundUpload(
      { clip: clip({ id: "clip_2", name: "Склад, пролёт" }), deduped: false, similarClipIds: ["clip_1", "clip_404"] },
      context,
    )
    expect(notice.tone).toBe("warning")
    expect(notice.text).toContain("похож")
    expect(notice.similarNames).toEqual(["Экран онбординга", "clip_404"])
  })

  it("чистая загрузка — успех без лишних предупреждений", () => {
    const notice = describeBackgroundUpload(
      { clip: clip({ id: "clip_3", name: "Схема тарифов" }), deduped: false, similarClipIds: [] },
      context,
    )
    expect(notice.tone).toBe("success")
    expect(notice.similarNames).toEqual([])
  })
})

describe("показ данных клипа", () => {
  it("безымянный фон получает подпись, а не пустую строку", () => {
    expect(clipTitle(clip({ name: null, id: "ckabcdef123" }))).toBe("Фон ckabcdef")
  })

  it("картинка без длительности так и называется", () => {
    expect(formatClipDuration(clip({ durationSec: null, kind: "image" }))).toBe("картинка")
    expect(formatClipDuration(clip({ durationSec: 72 }))).toBe("1:12")
  })

  it("BigInt из Prisma приходит строкой и всё равно суммируется", () => {
    const summary = summarizeLibrary([clip({ bytes: "1024" }), clip({ id: "c2", bytes: 2048 })])
    expect(summary).toEqual({ count: 2, bytes: 3072 })
  })
})
