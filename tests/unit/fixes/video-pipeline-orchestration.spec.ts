/**
 * Регрессии оркестрации видео: сброс шага, учёт денег, форма step-логов.
 * DB-free — всё, что тут проверяется, вынесено в чистые модули рядом с пайплайном.
 */
import { describe, expect, it } from "vitest"
import {
  assetTypesForSteps,
  isPathInsideDir,
  removeAssetFiles,
  STEP_ASSET_TYPES,
  STEP_RERUN_RESET_PATCH,
} from "../../../server/utils/video-pipeline-reset"
import {
  accumulateStepCost,
  computeClipActualCost,
  computeImageActualCost,
  imageMegapixels,
  stepAttemptForLedger,
} from "../../../server/utils/video-cost-actual"
import {
  appendAndTrimStepLogs,
  buildStepLogEntry,
  normalizeStepLogs,
  STEP_LOG_LIMIT,
} from "../../../server/utils/video-pipeline-log"

describe("W2: сброс шага сносит артефакты", () => {
  it("шаг → типы ассетов задан явной таблицей для всех шагов", () => {
    expect(Object.keys(STEP_ASSET_TYPES).sort()).toEqual([
      "assembly",
      "clip_generation",
      "edit_plan",
      "image_generation",
      "lip_sync_generation",
      "music_generation",
      "prompt_generation",
      "transcription",
      "voiceover_generation",
    ])
  })

  it("перезапуск с image_generation сносит и картинки, и всё, что после", () => {
    const types = assetTypesForSteps([
      "image_generation",
      "clip_generation",
      "voiceover_generation",
      "music_generation",
      "lip_sync_generation",
      "assembly",
    ])
    expect(types.sort()).toEqual(["clip", "image", "music", "voiceover", "voiceover_mix"])
  })

  it("перезапуск с lip_sync не сносит клипы — clip_generation при этом не переигрывается", () => {
    expect(assetTypesForSteps(["lip_sync_generation", "assembly"])).toEqual([])
  })

  it("патч сброса чистит fal-трекинг и outputSnapshot (иначе reattach к мёртвому job)", () => {
    for (const field of ["falRequestId", "falSubKey", "falEndpoint", "falQueueStatus", "outputSnapshot"]) {
      expect(STEP_RERUN_RESET_PATCH[field]).toBeNull()
    }
    expect(STEP_RERUN_RESET_PATCH.status).toBe("pending")
    expect(STEP_RERUN_RESET_PATCH.actualCost).toBeNull()
  })

  it("удаляет только файлы внутри каталога ассетов ролика", () => {
    expect(isPathInsideDir("/srv/storage/videos/7/assets", "/srv/storage/videos/7/assets/clip_0.mp4")).toBe(true)
    expect(isPathInsideDir("/srv/storage/videos/7/assets", "/srv/storage/videos/8/assets/clip_0.mp4")).toBe(false)
    expect(isPathInsideDir("/srv/storage/videos/7/assets", "/etc/passwd")).toBe(false)
    expect(isPathInsideDir("/srv/storage/videos/7/assets", "/srv/storage/videos/7/assets")).toBe(false)
  })

  it("сбой удаления одного файла не отменяет остальные", async () => {
    const dir = "/srv/storage/videos/7/assets"
    const removed: string[] = []
    const result = await removeAssetFiles(
      [`${dir}/a.mp4`, `${dir}/b.mp4`, "/etc/passwd", null],
      dir,
      {
        remove: async (path) => {
          if (path.endsWith("a.mp4")) throw new Error("EBUSY")
          removed.push(path)
        },
      },
    )
    expect(removed).toEqual([`${dir}/b.mp4`])
    expect(result).toEqual({ removed: 1, skipped: 1, failed: 1 })
  })
})

describe("W3: фактическая стоимость считается по сгенерированному", () => {
  it("переиспользованные с диска картинки не оплачиваются повторно", () => {
    const args = { format: "portrait", renderQuality: "high", pricePerMegapixel: 0.025 }
    expect(computeImageActualCost({ ...args, generatedCount: 0 })).toBe(0)
    expect(computeImageActualCost({ ...args, generatedCount: 3 }))
      .toBeCloseTo(3 * imageMegapixels("portrait", "high") * 0.025, 10)
  })

  it("клипы: сгенерированы все — считаем точно по длительностям сцен", () => {
    const scenes = [{ durationSec: 5 }, { durationSec: 7 }, { durationSec: 3 }]
    expect(computeClipActualCost({ scenes, generatedCount: 3, pricePerSecond: 0.1, fallbackDurationSec: 5 }))
      .toBeCloseTo(15 * 0.1, 10)
  })

  it("клипы: часть переиспользована — платим только за сгенерированные", () => {
    const scenes = [{ durationSec: 5 }, { durationSec: 7 }, { durationSec: 3 }]
    const cost = computeClipActualCost({ scenes, generatedCount: 1, pricePerSecond: 0.1, fallbackDurationSec: 5 })
    expect(cost).toBeCloseTo((15 / 3) * 0.1, 10)
    expect(cost).toBeLessThan(15 * 0.1)
  })

  it("клипы: ничего не сгенерировано — ноль, а не полная стоимость плана", () => {
    const scenes = [{ durationSec: 5 }, { durationSec: 7 }]
    expect(computeClipActualCost({ scenes, generatedCount: 0, pricePerSecond: 0.1, fallbackDurationSec: 5 })).toBe(0)
  })

  it("legacy без плана сцен — по фиксированной длительности клипа", () => {
    expect(computeClipActualCost({ scenes: [], generatedCount: 2, pricePerSecond: 0.1, fallbackDurationSec: 5 }))
      .toBeCloseTo(2 * 5 * 0.1, 10)
  })

  it("прогон без генерации не стирает уже потраченное на шаге", () => {
    expect(accumulateStepCost(0.42, 0)).toBeCloseTo(0.42, 10)
    expect(accumulateStepCost(0.42, 0.1)).toBeCloseTo(0.52, 10)
    expect(accumulateStepCost(null, 0.1)).toBeCloseTo(0.1, 10)
    expect(accumulateStepCost(undefined, -5)).toBe(0)
  })

  it("номер попытки для ledger: 0 (шаг не стартовал) читается как первая попытка", () => {
    expect(stepAttemptForLedger(0)).toBe(1)
    expect(stepAttemptForLedger(null)).toBe(1)
    expect(stepAttemptForLedger(2)).toBe(2)
  })
})

describe("W4: форма и обрезка step-логов", () => {
  it("запись сохраняет форму { ts, msg }", () => {
    const entry = buildStepLogEntry("Клип сцены 2 готов", new Date("2026-08-07T10:00:00.000Z"))
    expect(entry).toEqual({ ts: "2026-08-07T10:00:00.000Z", msg: "Клип сцены 2 готов" })
  })

  it("мусор в колонке не мешает записать новую строку", () => {
    expect(normalizeStepLogs(null)).toEqual([])
    expect(normalizeStepLogs({ ts: "x" })).toEqual([])
    expect(normalizeStepLogs([{ ts: "1", msg: "a" }, { nope: 1 }])).toEqual([{ ts: "1", msg: "a" }])
    expect(appendAndTrimStepLogs(null, buildStepLogEntry("первая"))).toHaveLength(1)
  })

  it("массив не растёт бесконечно — остаётся хвост", () => {
    const existing = Array.from({ length: STEP_LOG_LIMIT + 20 }, (_, i) => ({ ts: `t${i}`, msg: `m${i}` }))
    const next = appendAndTrimStepLogs(existing, buildStepLogEntry("последняя"))
    expect(next).toHaveLength(STEP_LOG_LIMIT)
    expect(next[next.length - 1]!.msg).toBe("последняя")
    expect(next[0]!.msg).toBe("m21")
  })
})
