/**
 * §7 спеки 2026-08-16-audio-first-editing-design: транскрипция и план
 * монтажа (`edit_plan`) — регулярные статьи расхода маршрута audio-first,
 * выполняются на КАЖДЫЙ ролик. Их тариф обязан попасть в смету ролика
 * (`estimate-cost`), иначе canary-критерий §12 «смета сходится с фактом»
 * не может выполниться — расход есть, а в смете его нет.
 *
 * На старом маршруте этих шагов нет вовсе — смета старого ролика обязана
 * остаться прежней до цента (AGENTS.md: «до удаления старого пути сначала
 * подтвердить работу его официальной замены», здесь тот же принцип «старый
 * маршрут не ломается»).
 */

import { describe, expect, it } from "vitest"
import { estimateVideoCost, type VideoCostConfig } from "~~/server/utils/video-cost"
import { estimateMediaCost, findMediaSpec } from "~~/server/utils/media-provider/registry"
import { EDIT_PLAN_MODEL_CALL_ESTIMATE_USD } from "~~/server/utils/video-cost-actual"

const BASE_CONFIG: VideoCostConfig = {
  sceneCount: 3,
  clipDuration: 5,
  generateAudio: true,
  enableMusic: true,
  voiceoverEnabled: false,
  quality: "1080p",
  perSceneDurations: [5, 6, 7],
}

describe("estimateVideoCost — статьи audio-first (транскрипция, план монтажа)", () => {
  it("старый маршрут: audioFirst не передан — сметы это не меняет ни на цент", () => {
    const withoutFlag = estimateVideoCost(BASE_CONFIG)
    const withExplicitFalse = estimateVideoCost({ ...BASE_CONFIG, audioFirst: false })

    for (const estimate of [withoutFlag, withExplicitFalse]) {
      expect(estimate.breakdown.some(item => item.stage === "transcription")).toBe(false)
      expect(estimate.breakdown.some(item => item.stage === "edit_plan")).toBe(false)
    }
    expect(withExplicitFalse.total).toBeCloseTo(withoutFlag.total, 10)
    expect(withExplicitFalse.breakdown.length).toBe(withoutFlag.breakdown.length)
  })

  it("audioFirst: true — обе статьи появляются, ставки берутся из спек, а не литералом", () => {
    const legacy = estimateVideoCost(BASE_CONFIG)
    const audioFirst = estimateVideoCost({ ...BASE_CONFIG, audioFirst: true })

    const transcriptionItem = audioFirst.breakdown.find(item => item.stage === "transcription")
    const editPlanItem = audioFirst.breakdown.find(item => item.stage === "edit_plan")
    expect(transcriptionItem).toBeDefined()
    expect(editPlanItem).toBeDefined()

    // Ставка транскрипции — из спеки REPLICATE_WHISPER (единственный источник
    // тарифа), а не отдельное число, продублированное в video-cost.ts.
    const whisperSpec = findMediaSpec("replicate:whisper")!
    const expectedTranscriptionCost = estimateMediaCost(whisperSpec, {})
    expect(expectedTranscriptionCost).toBeGreaterThan(0)
    expect(transcriptionItem!.subtotal).toBeCloseTo(expectedTranscriptionCost, 10)

    // Ставка edit_plan — ТА ЖЕ оценка, что runVideoEditPlan списывает как
    // fallback (priceEditPlanModelCall, video-pipeline-steps.ts), а не другой
    // независимый литерал: смета обязана быть honest-оценкой того же самого.
    expect(editPlanItem!.subtotal).toBeCloseTo(EDIT_PLAN_MODEL_CALL_ESTIMATE_USD, 10)

    // Смета выросла ровно на сумму обеих статей — остальные не тронуты.
    expect(audioFirst.total).toBeCloseTo(
      legacy.total + expectedTranscriptionCost + EDIT_PLAN_MODEL_CALL_ESTIMATE_USD,
      8,
    )
    // Остальные статьи (images/clips/music/...) должны совпасть 1:1 со старым
    // маршрутом — audioFirst добавляет статьи, а не пересчитывает старые.
    const oldStages = legacy.breakdown.map(item => item.stage)
    for (const stage of oldStages) {
      const oldItem = legacy.breakdown.find(item => item.stage === stage)!
      const newItem = audioFirst.breakdown.find(item => item.stage === stage)!
      expect(newItem.subtotal).toBeCloseTo(oldItem.subtotal, 10)
    }
  })

  it("транскрипция тарифицируется по времени GPU — смета не растёт со сценами/длительностью", () => {
    const short = estimateVideoCost({ ...BASE_CONFIG, perSceneDurations: [3], audioFirst: true })
    const long = estimateVideoCost({
      ...BASE_CONFIG,
      perSceneDurations: [9, 9, 9, 9, 9],
      audioFirst: true,
    })

    const shortItem = short.breakdown.find(item => item.stage === "transcription")!
    const longItem = long.breakdown.find(item => item.stage === "transcription")!
    expect(shortItem.subtotal).toBeCloseTo(longItem.subtotal, 10)
  })
})
