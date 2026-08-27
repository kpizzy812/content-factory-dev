import { describe, expect, it } from "vitest"

import {
  buildShotRows,
  readEditPlanShots,
  readSpokenScenes,
  readTrackRegenerationPreview,
  shotBackgroundLabel,
  shotStatusTone,
  spentOnBackground,
  stepwiseChoice,
  stepwiseOverrideValue,
  voiceSampleRejection,
} from "../../../app/components/video/edit-console-model"
import type { PlannedShot } from "../../../shared/types/edit-console"

function shot(over: Partial<PlannedShot> = {}): PlannedShot {
  return {
    order: 1,
    startSec: 0,
    endSec: 2.4,
    sceneOrder: 1,
    foreground: "presenter",
    background: "library",
    backgroundClipId: "clip_1",
    appReferenceId: null,
    idea: "Ведущий в кадре",
    pipEnabled: false,
    costUsd: 0,
    degradeReason: null,
    ...over,
  }
}

describe("кадры из снапшота шага «План монтажа»", () => {
  it("сообщает, что плана нет, вместо пустой таблицы", () => {
    expect(readEditPlanShots([]).available).toBe(false)
    expect(readEditPlanShots(undefined).available).toBe(false)
    expect(readEditPlanShots([{ stepKey: "edit_plan", status: "pending" }]).available).toBe(false)
  })

  it("читает кадры и предупреждения и сортирует по позиции", () => {
    const read = readEditPlanShots([
      { stepKey: "voiceover_generation", status: "completed", outputSnapshot: {} },
      {
        stepKey: "edit_plan",
        status: "completed",
        outputSnapshot: {
          shots: [shot({ order: 3 }), shot({ order: 1 })],
          warnings: ["Пауза 2 с перед сценой 5 не вставлена"],
        },
      },
    ])

    expect(read.available).toBe(true)
    expect(read.shots.map(s => s.order)).toEqual([1, 3])
    expect(read.warnings).toEqual(["Пауза 2 с перед сценой 5 не вставлена"])
  })
})

describe("строки таблицы кадров", () => {
  it("без факта не выдаёт план за факт", () => {
    const [row] = buildShotRows([shot()])

    expect(row!.backgroundActual).toBeNull()
    expect(shotBackgroundLabel(row!.backgroundActual)).toBe("—")
    expect(row!.degraded).toBe(false)
  })

  it("причина деградации из плана доезжает до строки", () => {
    const reason = "Потолок расхода на картинки $1.50 исчерпан (потрачено $1.498, картинка стоила бы $0.040)"
    const [row] = buildShotRows([shot({ background: "image", degradeReason: reason })])

    expect(row!.degraded).toBe(true)
    expect(row!.degradeReason).toBe(reason)
    expect(shotStatusTone(row!.status, row!.degraded)).toBe("warning")
  })

  it("расхождение плана и факта — тоже деградация, даже без причины", () => {
    const [row] = buildShotRows(
      [shot({ background: "video" })],
      [{ order: 1, backgroundActual: "image", status: "completed", costUsd: 0.04, degradeReason: null, assetPath: null }],
    )

    expect(row!.degraded).toBe(true)
    expect(shotBackgroundLabel(row!.background)).toBe("Видео")
    expect(shotBackgroundLabel(row!.backgroundActual)).toBe("Картинка")
  })

  it("факт перебивает план по деньгам и статусу", () => {
    const [row] = buildShotRows(
      [shot({ background: "video", costUsd: 0.35 })],
      [{ order: 1, backgroundActual: "video", status: "completed", costUsd: 0.42, degradeReason: null, assetPath: "a.mp4" }],
    )

    expect(row!.costUsd).toBe(0.42)
    expect(row!.status).toBe("completed")
    expect(shotStatusTone(row!.status)).toBe("success")
  })

  it("платной пересборку делает ПЛАН, а не прошлый результат", () => {
    // Кадр деградировал до пустого фона, но план по-прежнему просит видео:
    // повторная сборка снова пойдёт в платную модель.
    const [paid] = buildShotRows(
      [shot({ background: "video" })],
      [{ order: 1, backgroundActual: "none", status: "degraded", costUsd: 0, degradeReason: "нет фона", assetPath: null }],
    )
    expect(paid!.rerenderPaid).toBe(true)

    const [free] = buildShotRows([shot({ background: "library" })])
    expect(free!.rerenderPaid).toBe(false)
  })

  it("считает потраченное по источнику фона", () => {
    const rows = buildShotRows([
      shot({ order: 1, background: "image", costUsd: 0.04 }),
      shot({ order: 2, background: "image", costUsd: 0.04 }),
      shot({ order: 3, background: "video", costUsd: 0.35 }),
      shot({ order: 4, background: "library", costUsd: 0 }),
    ])

    expect(spentOnBackground(rows, "image")).toBeCloseTo(0.08, 6)
    expect(spentOnBackground(rows, "video")).toBeCloseTo(0.35, 6)
  })
})

describe("реплики озвучки", () => {
  it("берёт строки плана озвучки поверх spokenLine и выкидывает пустые сцены", () => {
    const scenes = readSpokenScenes({
      scenes: [
        { order: 1, spokenLine: "Старый текст" },
        { order: 2, spokenLine: "  " },
        { order: 3, spokenLine: "Третья реплика" },
      ],
      voiceoverPlan: { lines: [{ sceneOrder: 1, text: "Новый текст" }] },
    })

    expect(scenes).toEqual([
      { sceneOrder: 1, text: "Новый текст" },
      { sceneOrder: 3, text: "Третья реплика" },
    ])
  })

  it("сценария нет — список пуст, а не падение", () => {
    expect(readSpokenScenes(null)).toEqual([])
    expect(readSpokenScenes({ scenes: "не массив" })).toEqual([])
  })
})

describe("пошаговый режим — три состояния", () => {
  it("null отличается от явного выключения", () => {
    expect(stepwiseChoice(null)).toBe("inherit")
    expect(stepwiseChoice(undefined)).toBe("inherit")
    expect(stepwiseChoice(false)).toBe("off")
    expect(stepwiseChoice(true)).toBe("on")

    expect(stepwiseOverrideValue("inherit")).toBeNull()
    expect(stepwiseOverrideValue("off")).toBe(false)
    expect(stepwiseOverrideValue("on")).toBe(true)
  })
})

describe("смета и образец голоса", () => {
  it("смета читается из обеих форм ответа", () => {
    const preview = {
      sceneCount: 1,
      characters: 10,
      changedSceneOrders: [],
      voiceChanged: false,
      shotsToRebuild: 3,
      lipSyncSecondsToRepay: 5,
      estimatedCostUsd: 1.5,
    }

    expect(readTrackRegenerationPreview({ data: { data: { preview } } })).toEqual(preview)
    expect(readTrackRegenerationPreview({ data: { preview } })).toEqual(preview)
    expect(readTrackRegenerationPreview({ data: { message: "нет сметы" } })).toBeNull()
    expect(readTrackRegenerationPreview(null)).toBeNull()
  })

  it("образец не того формата отсекается до платного вызова", () => {
    expect(voiceSampleRejection({ name: "take.ogg", size: 1000 })).toContain("MP3")
    expect(voiceSampleRejection({ name: "take.mp3", size: 25 * 1024 * 1024 })).toContain("20 МБ")
    expect(voiceSampleRejection({ name: "take.wav", size: 1000 })).toBeNull()
    expect(voiceSampleRejection(null)).toBeNull()
  })
})
