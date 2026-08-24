import { describe, expect, it, vi } from "vitest"

import {
  appReferenceLocalPath,
  backgroundClipLocalPath,
  materializeAppReference,
  materializeBackgroundClip,
  type AppReferenceRef,
  type BackgroundClipRef,
  type ShotMediaDeps,
} from "~~/server/utils/edit-plan/shot-media-store"

const CLIP: BackgroundClipRef = {
  id: "bg1", storageKey: "zavodcamp/apps/7/backgrounds/abc123.mp4",
  sha1: "abc123", mimeType: "video/mp4", kind: "footage",
}

function deps(overrides: Partial<ShotMediaDeps> = {}): ShotMediaDeps {
  return {
    downloadToFile: vi.fn(async () => {}),
    fileExists: vi.fn(async () => false),
    ensureDir: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("материализация фона кадра", () => {
  it("имя локального файла детерминировано и включает sha1 — пересборка берёт тот же файл", () => {
    const a = backgroundClipLocalPath("/assets/12", CLIP)
    const b = backgroundClipLocalPath("/assets/12", CLIP)
    expect(a).toBe(b)
    expect(a).toContain("abc123")
    expect(a.endsWith(".mp4")).toBe(true)
  })

  it("расширение берётся из mimeType, а не из storageKey", () => {
    const png = backgroundClipLocalPath("/assets/12", { ...CLIP, mimeType: "image/png", kind: "image" })
    expect(png.endsWith(".png")).toBe(true)
  })

  it("файл уже на диске — второй раз не качаем", async () => {
    const d = deps({ fileExists: vi.fn(async () => true) })
    const path = await materializeBackgroundClip(CLIP, "/assets/12", d)
    expect(path).toBe(backgroundClipLocalPath("/assets/12", CLIP))
    expect(d.downloadToFile).not.toHaveBeenCalled()
  })

  it("файла нет — качаем ровно по storageKey ровно один раз", async () => {
    const d = deps()
    await materializeBackgroundClip(CLIP, "/assets/12", d)
    expect(d.downloadToFile).toHaveBeenCalledTimes(1)
    expect(d.downloadToFile).toHaveBeenCalledWith(CLIP.storageKey, backgroundClipLocalPath("/assets/12", CLIP))
  })

  it("падение загрузки не прячется — вызывающий обязан узнать причину", async () => {
    const d = deps({ downloadToFile: vi.fn(async () => { throw new Error("сеть недоступна") }) })
    await expect(materializeBackgroundClip(CLIP, "/assets/12", d)).rejects.toThrow("сеть недоступна")
  })
})

describe("материализация скрина приложения", () => {
  const WITH_KEY: AppReferenceRef = {
    id: "r1", appId: 7, sha1: "deadbeef", mimeType: "image/png",
    storageKey: "zavodcamp/apps/7/references/deadbeef.png",
  }
  const LEGACY: AppReferenceRef = { ...WITH_KEY, storageKey: null }

  it("есть storageKey — качаем из хранилища", async () => {
    const d = deps()
    await materializeAppReference(WITH_KEY, "/assets/12", d)
    expect(d.downloadToFile).toHaveBeenCalledWith(WITH_KEY.storageKey, appReferenceLocalPath("/assets/12", WITH_KEY))
  })

  it("storageKey нет (legacy-запись) — читаем локальный путь app-references и НЕ качаем", async () => {
    const d = deps()
    const path = await materializeAppReference(LEGACY, "/assets/12", d)
    expect(d.downloadToFile).not.toHaveBeenCalled()
    expect(path).toContain("app-references")
    expect(path).toContain("deadbeef")
  })
})
