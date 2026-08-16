/**
 * Регрессия: озвучка и сборка меряют ОДНИ И ТЕ ЖЕ файлы.
 *
 * Сборка склеивает не исходные клипы, а нормализованные (единый кодек, fps и
 * таймбаза — без этого concat даёт застывшие кадры на стыках). Нормализация
 * режет по границе кадра и укорачивает клип на 0.02-0.06 с. Шаг озвучки при
 * этом мерил ИСХОДНЫЕ файлы: ошибка копилась от сцены к сцене, и на ролике 24 к
 * восьмой сцене реплика заезжала в следующую на 0.18 с — «поверх неоконченного
 * тейка она что-то говорит».
 *
 * Правило: клипы нормализуются один раз, до озвучки, и дальше по конвейеру идут
 * уже нормализованные пути.
 */

import { describe, expect, it } from "vitest"
import { isNormalizedClipPath } from "../../../server/utils/presenter/scene-clip-mapping"

describe("isNormalizedClipPath", () => {
  it("узнаёт уже нормализованный файл", () => {
    expect(isNormalizedClipPath("/a/scene_0_lipsync_norm.mp4")).toBe(true)
    expect(isNormalizedClipPath("/a/scene_2_clip_norm.mp4")).toBe(true)
  })

  it("исходный клип нормализованным не считает", () => {
    expect(isNormalizedClipPath("/a/scene_2_clip.mp4")).toBe(false)
    expect(isNormalizedClipPath("/a/scene_0_lipsync.mp4")).toBe(false)
  })

  it("пустая ячейка сцены — не файл", () => {
    expect(isNormalizedClipPath("")).toBe(false)
    expect(isNormalizedClipPath(null)).toBe(false)
  })

  it("удлинённый озвучкой клип нормализованным остаётся", () => {
    // extend_scene делает из нормализованного файла `..._norm_ext.mp4`:
    // повторно гонять его через нормализацию — снова резать длину.
    expect(isNormalizedClipPath("/a/scene_2_clip_norm_ext.mp4")).toBe(true)
  })
})
