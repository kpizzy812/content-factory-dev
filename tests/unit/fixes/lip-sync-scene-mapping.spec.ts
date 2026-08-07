/**
 * Регрессия: шаг lip-sync накладывал синхронизацию на чужие клипы.
 *
 * Дефекты:
 *   L1 — клип искали по scene.order (1-based из storyPlan), а клипы лежат с
 *        order = индекс цикла (0-based): реплика уезжала на соседнюю сцену,
 *        последняя сцена всегда получала «не найден клип».
 *   L2 — источником брали clipAsset.filePath, где после первого прогона уже
 *        лежит *_lipsync.mp4: синхронизация ложилась поверх синхронизации.
 *   L4 — исходник ведущего подбирался без учёта диапазона длительностей модели.
 *
 * Здесь покрыта чистая часть фикса (server/utils/presenter/scene-clip-mapping.ts).
 */

import { describe, it, expect } from "vitest"
import {
  buildSceneClipIndexMap,
  hashSpokenLine,
  isDurationWithinModelRange,
  isLipSyncOutputPath,
  isSourceDurationCloseToScene,
  pickClosestPresenterCandidate,
  resolveSceneSourcePath,
} from "../../../server/utils/presenter/scene-clip-mapping"

describe("buildSceneClipIndexMap", () => {
  it("1-based order из storyPlan превращает в 0-based индекс клипа", () => {
    const map = buildSceneClipIndexMap([{ order: 1 }, { order: 2 }, { order: 3 }])
    expect(map.get(1)).toBe(0)
    expect(map.get(2)).toBe(1)
    expect(map.get(3)).toBe(2)
  })

  it("последняя сцена больше не теряется (раньше order=3 не находил клип order=2)", () => {
    const map = buildSceneClipIndexMap([{ order: 1 }, { order: 2 }, { order: 3 }])
    expect(map.get(3)).not.toBeUndefined()
    expect(map.size).toBe(3)
  })

  it("работает и при нестандартной нумерации — важна позиция, а не значение order", () => {
    const map = buildSceneClipIndexMap([{ order: 10 }, { order: 20 }, { order: 30 }])
    expect(map.get(10)).toBe(0)
    expect(map.get(30)).toBe(2)
  })

  it("дубликат order не перетягивает чужой клип — побеждает первая позиция", () => {
    const map = buildSceneClipIndexMap([{ order: 1 }, { order: 1 }, { order: 2 }])
    expect(map.get(1)).toBe(0)
    expect(map.get(2)).toBe(2)
  })

  // L6: клипы нарезаются по prompts.scenePrompts.scenes, чей порядок задаёт Claude
  // и никто не нормализует. Позиция в videoPlan.scenes при перестановке врёт.
  it("порядок клипов важнее позиции сцены в плане", () => {
    const plan = [{ order: 1 }, { order: 2 }, { order: 3 }, { order: 4 }, { order: 5 }]
    // Claude вернул промпты в порядке 1,2,4,3,5 — clipPaths[2] это сцена 4.
    const map = buildSceneClipIndexMap(plan, [1, 2, 4, 3, 5])
    expect(map.get(3)).toBe(3)
    expect(map.get(4)).toBe(2)
    expect(map.get(1)).toBe(0)
    expect(map.get(5)).toBe(4)
  })

  it("сцена, которой нет в порядке клипов, чужой индекс не занимает", () => {
    const map = buildSceneClipIndexMap([{ order: 1 }, { order: 2 }, { order: 7 }], [1, 2])
    expect(map.get(1)).toBe(0)
    expect(map.get(2)).toBe(1)
    // Индексы 0 и 1 уже разобраны — сцена 7 остаётся без клипа, а не забирает чужой.
    expect(map.get(7)).toBeUndefined()
  })

  it("пустой порядок клипов — прежний фолбэк на позиции плана", () => {
    const map = buildSceneClipIndexMap([{ order: 1 }, { order: 2 }], null)
    expect(map.get(1)).toBe(0)
    expect(map.get(2)).toBe(1)
  })
})

describe("isLipSyncOutputPath", () => {
  it("узнаёт результат прошлого прогона", () => {
    expect(isLipSyncOutputPath("/data/1/scene_0_lipsync.mp4")).toBe(true)
    expect(isLipSyncOutputPath("/data/1/scene_0_LIPSYNC.MP4")).toBe(true)
  })

  it("оригинальные клипы не считает синхронизированными", () => {
    expect(isLipSyncOutputPath("/data/1/scene_1_clip.mp4")).toBe(false)
    expect(isLipSyncOutputPath(null)).toBe(false)
    expect(isLipSyncOutputPath(undefined)).toBe(false)
  })
})

describe("resolveSceneSourcePath", () => {
  const clipPaths = ["/a/scene_1_clip.mp4", "/a/scene_2_clip.mp4", "/a/scene_3_clip.mp4"]

  it("источник берётся из clipPaths по индексу сцены", () => {
    const resolved = resolveSceneSourcePath({
      sceneIndex: 1,
      clipPaths,
      assetFilePath: "/a/scene_2_clip.mp4",
    })
    expect(resolved.path).toBe("/a/scene_2_clip.mp4")
    expect(resolved.origin).toBe("clip_paths")
    expect(resolved.mismatch).toBe(false)
  })

  it("повторный заход: в БД lipsync-файл, но синхронизируем оригинал и отмечаем расхождение", () => {
    const resolved = resolveSceneSourcePath({
      sceneIndex: 0,
      clipPaths,
      assetFilePath: "/a/scene_0_lipsync.mp4",
    })
    expect(resolved.path).toBe("/a/scene_1_clip.mp4")
    expect(resolved.mismatch).toBe(true)
  })

  it("если clipPaths короче — берём сохранённый в снапшоте исходник", () => {
    const resolved = resolveSceneSourcePath({
      sceneIndex: 5,
      clipPaths,
      assetFilePath: "/a/scene_5_lipsync.mp4",
      snapshotSourcePath: "/a/scene_6_clip.mp4",
    })
    expect(resolved.path).toBe("/a/scene_6_clip.mp4")
    expect(resolved.origin).toBe("snapshot")
  })

  it("уже синхронизированный файл источником не становится ни при каком приоритете", () => {
    const resolved = resolveSceneSourcePath({
      sceneIndex: 0,
      clipPaths: ["/a/scene_0_lipsync.mp4"],
      assetFilePath: "/a/scene_0_lipsync.mp4",
      snapshotSourcePath: "/a/scene_0_lipsync.mp4",
    })
    expect(resolved.path).toBeNull()
    expect(resolved.origin).toBe("none")
  })

  it("нет ни одного кандидата — сцена пропускается, а не падает", () => {
    const resolved = resolveSceneSourcePath({ sceneIndex: 2, clipPaths: [] })
    expect(resolved.path).toBeNull()
  })
})

describe("isDurationWithinModelRange", () => {
  it("kling-lip-sync принимает 2-10 секунд", () => {
    expect(isDurationWithinModelRange(2, 2, 10)).toBe(true)
    expect(isDurationWithinModelRange(6.4, 2, 10)).toBe(true)
    expect(isDurationWithinModelRange(10, 2, 10)).toBe(true)
  })

  it("выход за диапазон и мусор отбраковываются", () => {
    expect(isDurationWithinModelRange(1.5, 2, 10)).toBe(false)
    expect(isDurationWithinModelRange(12, 2, 10)).toBe(false)
    expect(isDurationWithinModelRange(Number.NaN, 2, 10)).toBe(false)
  })
})

describe("pickClosestPresenterCandidate", () => {
  it("выбирает ближайший по длительности, а не просто первый least-used", () => {
    const candidates = [
      { id: "a", durationSec: 9 },
      { id: "b", durationSec: 5.1 },
      { id: "c", durationSec: 3 },
    ]
    expect(pickClosestPresenterCandidate(candidates, 5)?.id).toBe("b")
  })

  it("при равной близости побеждает наименее использованный (первый в списке)", () => {
    const candidates = [
      { id: "least-used", durationSec: 5 },
      { id: "more-used", durationSec: 5.01 },
    ]
    expect(pickClosestPresenterCandidate(candidates, 5)?.id).toBe("least-used")
  })

  it("пустой пул — null (вызывающий останется на сгенерированном клипе)", () => {
    expect(pickClosestPresenterCandidate([], 5)).toBeNull()
  })

  it("кандидаты с битой длительностью игнорируются", () => {
    const candidates = [
      { id: "broken", durationSec: Number.NaN },
      { id: "ok", durationSec: 5.4 },
    ]
    expect(pickClosestPresenterCandidate(candidates, 5)?.id).toBe("ok")
  })

  // L5: «ближайший» без потолка означал «хоть какой-нибудь» — сцене на 9 с отдавали
  // клип на 2.5 с (внутри 2-10 с модели) и молча резали 6.5 с хронометража.
  it("кандидат дальше maxDeltaSec не берётся вовсе", () => {
    const candidates = [{ id: "too-short", durationSec: 2.5 }]
    expect(pickClosestPresenterCandidate(candidates, 9)).toBeNull()
  })

  it("предел расхождения настраивается", () => {
    const candidates = [{ id: "loose", durationSec: 7 }]
    expect(pickClosestPresenterCandidate(candidates, 5)).toBeNull()
    expect(pickClosestPresenterCandidate(candidates, 5, { maxDeltaSec: 2 })?.id).toBe("loose")
  })
})

describe("isSourceDurationCloseToScene", () => {
  it("исходник ведущего внутри диапазона модели, но чужой длины — не годится", () => {
    // Ровно та дыра, которую isDurationWithinModelRange не видит: 2.5с ∈ [2,10].
    expect(isSourceDurationCloseToScene(2.5, 9)).toBe(false)
  })

  it("расхождение в пределах секунды допустимо", () => {
    expect(isSourceDurationCloseToScene(8.4, 9)).toBe(true)
    expect(isSourceDurationCloseToScene(9, 9)).toBe(true)
  })

  it("мусорные значения не проходят", () => {
    expect(isSourceDurationCloseToScene(Number.NaN, 9)).toBe(false)
    expect(isSourceDurationCloseToScene(9, Number.NaN)).toBe(false)
  })
})

describe("hashSpokenLine", () => {
  it("одинаковый текст (с точностью до краевых пробелов) даёт один хэш — TTS переиспользуется", () => {
    expect(hashSpokenLine("  Привет, это Reforma ")).toBe(hashSpokenLine("Привет, это Reforma"))
  })

  it("изменённая реплика инвалидирует и аудио, и готовый lip-sync", () => {
    expect(hashSpokenLine("Реплика A")).not.toBe(hashSpokenLine("Реплика B"))
  })
})
