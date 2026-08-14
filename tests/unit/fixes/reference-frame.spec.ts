/**
 * Опорный кадр для image-to-video.
 *
 * Раньше i2v включался ровно одним условием — привязкой сцены к скриншоту
 * приложения (`appScreenRef` → AppReferenceImage). ContentFactory универсален:
 * оживлять нужно любой референс — портрет ведущего для AI-аватара, референс
 * сцены, кадр приложения. Здесь проверяется нормализация ссылки и загрузка
 * файла по источнику; сеть и БД подменены инъекцией.
 */

import { describe, expect, it } from "vitest"
import {
  loadReferenceFrames,
  normalizeSceneReferenceFrame,
  planReferenceFrameDelivery,
  referenceFrameKey,
} from "../../../server/utils/media-provider/reference-frame"

describe("normalizeSceneReferenceFrame", () => {
  it("читает старое поле appScreenRef как источник app_screen", () => {
    // Снапшоты уже запущенных роликов и промпт сценариста знают только про
    // appScreenRef — ломать их нельзя.
    expect(normalizeSceneReferenceFrame({ appScreenRef: { imageId: "img_1" } }))
      .toEqual({ source: "app_screen", imageId: "img_1" })
  })

  it("понимает референс персонажа и референс сцены", () => {
    expect(normalizeSceneReferenceFrame({ referenceFrame: { source: "character", imageId: "ref_1" } }))
      .toEqual({ source: "character", imageId: "ref_1" })
    expect(normalizeSceneReferenceFrame({ referenceFrame: { source: "scene", imageId: "ref_2" } }))
      .toEqual({ source: "scene", imageId: "ref_2" })
  })

  it("явный referenceFrame выигрывает у устаревшего appScreenRef", () => {
    expect(normalizeSceneReferenceFrame({
      referenceFrame: { source: "character", imageId: "ref_1" },
      appScreenRef: { imageId: "img_1" },
    })).toEqual({ source: "character", imageId: "ref_1" })
  })

  it("пустая и незнакомая ссылка дают null, а не падение", () => {
    // Сцена без опорного кадра снимается text-to-video; неизвестный источник
    // приходит из чужого снапшота и не должен ронять весь шаг.
    expect(normalizeSceneReferenceFrame({})).toBeNull()
    expect(normalizeSceneReferenceFrame({ appScreenRef: null })).toBeNull()
    expect(normalizeSceneReferenceFrame({ referenceFrame: { source: "hologram", imageId: "x" } })).toBeNull()
    expect(normalizeSceneReferenceFrame({ referenceFrame: { source: "character", imageId: "  " } })).toBeNull()
  })
})

describe("loadReferenceFrames", () => {
  const deps = {
    async findAppReferences(ids: string[]) {
      return ids.filter(id => id === "app_1").map(id => ({
        id,
        appId: 7,
        fileUrl: "/api/files/app-references/7/screen.png",
        mimeType: null,
        storageKey: null,
      }))
    },
    async findCharacterReferences(ids: string[]) {
      return ids.filter(id => id === "char_1").map(id => ({
        id,
        fileUrl: "/api/files/characters/portrait.jpg",
        mimeType: "image/jpeg",
        storageKey: "characters/1/portrait.jpg",
      }))
    },
    async findSceneReferences(ids: string[]) {
      return ids.filter(id => id === "scene_1").map(id => ({
        id,
        fileUrl: "/api/files/scenes/mood.webp",
        mimeType: "image/webp",
        storageKey: "scenes/1/mood.webp",
      }))
    },
  }

  it("спрашивает только те источники, которые встретились в сценах", async () => {
    const asked: string[] = []
    await loadReferenceFrames(
      [{ source: "character", imageId: "char_1" }],
      {
        ...deps,
        async findAppReferences(ids) {
          asked.push("app")
          return deps.findAppReferences(ids)
        },
        async findSceneReferences(ids) {
          asked.push("scene")
          return deps.findSceneReferences(ids)
        },
      },
    )
    expect(asked).toEqual([])
  })

  it("возвращает записи под ключом источник+id и подставляет mime по расширению", async () => {
    const frames = await loadReferenceFrames(
      [
        { source: "app_screen", imageId: "app_1" },
        { source: "character", imageId: "char_1" },
        { source: "scene", imageId: "scene_1" },
      ],
      deps,
    )

    expect(frames.get(referenceFrameKey({ source: "app_screen", imageId: "app_1" }))).toEqual({
      source: "app_screen",
      imageId: "app_1",
      appId: 7,
      fileUrl: "/api/files/app-references/7/screen.png",
      storageKey: null,
      mimeType: "image/png",
    })
    expect(frames.get(referenceFrameKey({ source: "character", imageId: "char_1" }))?.mimeType)
      .toBe("image/jpeg")
    expect(frames.get(referenceFrameKey({ source: "scene", imageId: "scene_1" }))?.storageKey)
      .toBe("scenes/1/mood.webp")
  })

  it("удалённый референс не попадает в результат — сцена откатится на text-to-video", async () => {
    const frames = await loadReferenceFrames(
      [{ source: "character", imageId: "исчез" }],
      deps,
    )
    expect(frames.size).toBe(0)
  })

  it("один и тот же id в разных источниках не путается — контроль ключа", async () => {
    // Ключ обязан включать источник: id генерируются независимо в трёх таблицах.
    const frames = await loadReferenceFrames(
      [
        { source: "app_screen", imageId: "app_1" },
        { source: "character", imageId: "app_1" },
      ],
      deps,
    )
    expect(frames.size).toBe(1)
    expect(frames.has(referenceFrameKey({ source: "app_screen", imageId: "app_1" }))).toBe(true)
  })
})

describe("planReferenceFrameDelivery", () => {
  it("постоянное хранилище выигрывает у любого другого пути", () => {
    // Файл в объектном хранилище переживает пересоздание контейнера, локальный —
    // нет (docs/operations/presenter-library.md, «Хранилище должно переживать деплой»).
    expect(planReferenceFrameDelivery({
      source: "character",
      imageId: "ref_1",
      appId: null,
      fileUrl: "/api/files/characters/portrait.jpg",
      storageKey: "characters/1/portrait.jpg",
      mimeType: "image/jpeg",
    })).toEqual({ kind: "storage", storageKey: "characters/1/portrait.jpg" })
  })

  it("скриншот приложения без storageKey читается из legacy-каталога загрузок", () => {
    expect(planReferenceFrameDelivery({
      source: "app_screen",
      imageId: "app_1",
      appId: 7,
      fileUrl: "/api/files/app-references/7/screen.png",
      storageKey: null,
      mimeType: "image/png",
    })).toEqual({ kind: "legacy_app_file", appId: 7, fileUrl: "/api/files/app-references/7/screen.png" })
  })

  it("внешний URL без storageKey скачивается по сети", () => {
    expect(planReferenceFrameDelivery({
      source: "scene",
      imageId: "scene_1",
      appId: null,
      fileUrl: "https://cdn.example.com/mood.webp",
      storageKey: null,
      mimeType: "image/webp",
    })).toEqual({ kind: "http", url: "https://cdn.example.com/mood.webp" })
  })

  it("референс без storageKey и без внешнего URL доставить нечем", () => {
    // Такая запись осталась от удалённого файла: честный null лучше, чем попытка
    // скачать относительный путь и невнятная ошибка сети внутри платного шага.
    expect(planReferenceFrameDelivery({
      source: "character",
      imageId: "ref_1",
      appId: null,
      fileUrl: "/api/files/characters/portrait.jpg",
      storageKey: null,
      mimeType: "image/jpeg",
    })).toBeNull()
  })
})
