/**
 * Превью фонов библиотеки: ссылка на файл в ответе списка.
 *
 * Долг из отчёта `admin-edit-profile-backgrounds-report.md` §8.2: список
 * отдавал `storageKey`, и карточка фона показывала иконку по типу — оператор
 * выбирал фон вслепую.
 *
 * Механизм ссылок в проекте уже есть и он ОДИН — `resolvePublicMediaUrl`
 * (`server/utils/social/public-media.ts`). Третий заводить нельзя, поэтому
 * тесты ниже прибивают именно переиспользование: у gcs-драйвера подписанная
 * ссылка провайдера, у остальных — отдача через своё приложение подписанным
 * токеном `/api/public/media/:token`.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  backgroundPreviewContentType,
  withBackgroundPreviewUrls,
} from "../../../server/utils/edit-plan/background-preview"
import {
  PUBLIC_MEDIA_MIME_TYPES,
  publicMediaContentType,
  verifyPublicMediaToken,
} from "../../../server/utils/social/public-media"
import type { StorageDriver } from "../../../server/utils/storage/types"

const secret = "c".repeat(64)
const baseUrl = "https://factory.test"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

interface SignCall { key: string, responseContentType?: string, expiresInSec?: number }

function fakeDriver(providerName: StorageDriver["providerName"], calls: SignCall[] = []): StorageDriver {
  return {
    providerName,
    async getSignedDownloadUrl(key, opts) {
      calls.push({
        key,
        responseContentType: opts?.responseContentType,
        expiresInSec: opts?.expiresInSec,
      })
      return `https://storage.test/${key}?signed=1`
    },
  } as unknown as StorageDriver
}

const videoClip = {
  id: "clip-video",
  storageKey: "zavodcamp/apps/7/backgrounds/aaaa1111.mp4",
  mimeType: "video/mp4",
}

const imageClip = {
  id: "clip-image",
  storageKey: "zavodcamp/apps/7/backgrounds/bbbb2222.png",
  mimeType: "image/png",
}

describe("ссылка на фон переиспользует общий механизм публичной отдачи", () => {
  it("gcs — подписанная ссылка провайдера с НАСТОЯЩИМ типом файла", async () => {
    const calls: SignCall[] = []
    const clips = await withBackgroundPreviewUrls([videoClip, imageClip], {
      driver: fakeDriver("gcs", calls),
      baseUrl,
      secret,
    })

    expect(clips[0]!.previewUrl).toBe(`https://storage.test/${videoClip.storageKey}?signed=1`)
    expect(clips[1]!.previewUrl).toBe(`https://storage.test/${imageClip.storageKey}?signed=1`)

    // Картинка не должна уехать с `video/mp4` — иначе браузер получит png,
    // объявленный видео, и карточка снова окажется пустой рамкой.
    expect(calls.map(c => c.responseContentType)).toEqual(["video/mp4", "image/png"])
  })

  it("остальные драйверы — отдача через своё приложение, токен разбирается обратно", async () => {
    const now = 1_700_000_000_000
    const clips = await withBackgroundPreviewUrls([imageClip], {
      driver: fakeDriver("local"),
      baseUrl,
      secret,
      now,
      ttlSeconds: 3600,
    })

    const url = clips[0]!.previewUrl!
    expect(url.startsWith(`${baseUrl}/api/public/media/`)).toBe(true)

    const token = url.slice(`${baseUrl}/api/public/media/`.length)
    expect(verifyPublicMediaToken(token, secret, now)).toEqual({
      source: "storage",
      path: imageClip.storageKey,
      expiresAt: now + 3600 * 1000,
    })
  })

  it("без явного адреса ссылка ОТНОСИТЕЛЬНАЯ — превью живёт в своём же интерфейсе", async () => {
    // Общий механизм по умолчанию требует абсолютный публичный адрес
    // (`CONTENT_FACTORY_PUBLIC_URL`) — он нужен Instagram, который тянет файл
    // со своей стороны. Превью фона показывает наш собственный экран, и
    // отсутствие публичного адреса не должно гасить его на всех стендах, где
    // он не настроен.
    const clips = await withBackgroundPreviewUrls([imageClip], {
      driver: fakeDriver("local"),
      secret,
    })

    expect(clips[0]!.previewUrl!.startsWith("/api/public/media/")).toBe(true)
  })

  it("клип, на который ссылку собрать не удалось, отдаётся с previewUrl: null и не уносит соседей", async () => {
    // Ключ вне `zavodcamp/` не пройдёт PrefixGuard внутри общего механизма.
    const broken = { id: "clip-broken", storageKey: "../../etc/passwd", mimeType: "image/png" }

    const clips = await withBackgroundPreviewUrls([broken, videoClip], {
      driver: fakeDriver("gcs"),
      baseUrl,
      secret,
    })

    expect(clips[0]!.previewUrl).toBeNull()
    expect(clips[1]!.previewUrl).not.toBeNull()
  })

  it("остальные поля клипа не теряются", async () => {
    const clips = await withBackgroundPreviewUrls(
      [{ ...imageClip, name: "Экран онбординга", usageCount: 3 }],
      { driver: fakeDriver("gcs"), baseUrl, secret },
    )
    expect(clips[0]!.name).toBe("Экран онбординга")
    expect(clips[0]!.usageCount).toBe(3)
  })
})

describe("тип содержимого фона", () => {
  it("берётся из mimeType записи", () => {
    expect(backgroundPreviewContentType(imageClip)).toBe("image/png")
  })

  it("выводится из расширения ключа, когда mimeType пуст", () => {
    expect(backgroundPreviewContentType({ storageKey: "zavodcamp/a/b/c.webp", mimeType: null }))
      .toBe("image/webp")
    expect(backgroundPreviewContentType({ storageKey: "zavodcamp/a/b/c.mov", mimeType: null }))
      .toBe("video/quicktime")
  })

  it("неизвестное расширение без mimeType — null, а не выдуманный тип", () => {
    expect(backgroundPreviewContentType({ storageKey: "zavodcamp/a/b/c.bin", mimeType: null }))
      .toBeNull()
  })
})

describe("отдача через своё приложение знает форматы библиотеки фонов", () => {
  it("карта типов покрывает КАЖДОЕ расширение из ALLOWED_BACKGROUND_MIME", () => {
    // Читаем серверный файл текстом (тот же приём, что в тестах библиотеки
    // фонов): импорт `background-store.ts` тянет ffmpeg-адаптер, а нам нужен
    // только список расширений.
    const store = file("server/utils/edit-plan/background-store.ts")
    const extensions = [...store.matchAll(/ext:\s*"([a-z0-9]+)"/g)].map(m => m[1]!)
    expect(extensions.length).toBeGreaterThan(0)
    for (const ext of extensions) {
      expect(PUBLIC_MEDIA_MIME_TYPES[`.${ext}`], `.${ext}`).toBeTruthy()
    }
  })

  it("маршрут /api/public/media/:token берёт карту типов из общего модуля, а не заводит свою", () => {
    const route = file("server/api/public/media/[token].get.ts")
    expect(route).toContain("PUBLIC_MEDIA_MIME_TYPES")
    // Своей копии карты в маршруте больше нет: иначе png снова поехал бы
    // `application/octet-stream`, а починили бы только одно из двух мест.
    expect(route).not.toContain("const MIME_TYPES")
  })

  it("публичный тип содержимого читается по расширению пути", () => {
    expect(publicMediaContentType("zavodcamp/apps/7/backgrounds/bbbb2222.png")).toBe("image/png")
    expect(publicMediaContentType("zavodcamp/videos/1/final.mp4")).toBe("video/mp4")
    expect(publicMediaContentType("zavodcamp/videos/1/final.bin")).toBeNull()
  })
})

describe("список фонов отдаёт ссылку, а не только ключ хранилища", () => {
  const endpoints = [
    "server/api/apps/[id]/background-clips/index.get.ts",
    "server/api/apps/[id]/background-clips/[clipId].delete.ts",
    "server/api/apps/[id]/background-clips/index.post.ts",
  ]

  it.each(endpoints)("%s собирает превью общим механизмом", (path) => {
    const source = file(path)
    expect(source).toContain("withBackgroundPreviewUrls")
    // Ручка не подписывает ссылку сама и не ходит в драйвер напрямую.
    expect(source).not.toContain("getSignedDownloadUrl")
  })
})
