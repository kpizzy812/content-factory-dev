/**
 * Вид фона кадра — `shotBackgroundIsStill` (Task 5, фикс-раунд 1, Important 1/2
 * ревью). Проверяет ОБА эшелона решения: `contentType`, когда он заполнен
 * (основной путь — `runShotBackgrounds` пишет его при создании/обновлении
 * ассета `shot_background`), и расширение файла, когда `contentType` пуст
 * (фолбэк для строк, записанных до этой правки, и для будущих провалов
 * классификации по mime).
 */
import { describe, expect, it } from "vitest"

import { shotBackgroundIsStill } from "~~/server/utils/video-pipeline-steps"

describe("вид фона кадра по факту на диске (shotBackgroundIsStill)", () => {
  it("contentType задан video/* — решает он, даже если расширение похоже на картинку", () => {
    expect(shotBackgroundIsStill({ contentType: "video/mp4", filePath: "/a/shot_1_bg.png" })).toBe(false)
  })

  it("contentType задан image/* — решает он, даже если расширение похоже на видео", () => {
    expect(shotBackgroundIsStill({ contentType: "image/png", filePath: "/a/shot_1_bg.mp4" })).toBe(true)
  })

  it("contentType пуст (null), расширение видео (.mp4/.mov/.webm) — решает расширение", () => {
    expect(shotBackgroundIsStill({ contentType: null, filePath: "/a/shot_2_bg.mp4" })).toBe(false)
    expect(shotBackgroundIsStill({ contentType: null, filePath: "/a/shot_2_bg.mov" })).toBe(false)
    expect(shotBackgroundIsStill({ contentType: null, filePath: "/a/shot_2_bg.webm" })).toBe(false)
  })

  it("contentType пуст (null), расширение картинки — решает расширение", () => {
    expect(shotBackgroundIsStill({ contentType: null, filePath: "/a/shot_3_bg.png" })).toBe(true)
    expect(shotBackgroundIsStill({ contentType: null, filePath: "/a/shot_3_bg.jpg" })).toBe(true)
  })

  it("contentType пуст (null), расширение НЕИЗВЕСТНО — фолбэк трактует как картинку", () => {
    // Тот же дефолт, что уже был у extFor/shotBackgroundExt для незнакомого
    // mime (shot-media-store.ts, still-clip.ts): "не видео — значит кадр",
    // а не наоборот. Осознанный выбор одной стороны, а не гадание.
    expect(shotBackgroundIsStill({ contentType: null, filePath: "/a/shot_4_bg.mkv" })).toBe(true)
    expect(shotBackgroundIsStill({ contentType: null, filePath: "/a/shot_4_bg" })).toBe(true)
  })

  it("contentType — пустая строка тоже трактуется как отсутствие, работает фолбэк по расширению", () => {
    expect(shotBackgroundIsStill({ contentType: "", filePath: "/a/shot_5_bg.mp4" })).toBe(false)
    expect(shotBackgroundIsStill({ contentType: "", filePath: "/a/shot_5_bg.png" })).toBe(true)
  })

  it("contentType — незнакомый тип (не image/* и не video/*) — тоже проваливается в фолбэк по расширению", () => {
    expect(shotBackgroundIsStill({ contentType: "application/octet-stream", filePath: "/a/shot_6_bg.mp4" })).toBe(false)
  })
})
