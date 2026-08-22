import { describe, expect, it } from "vitest"

import { STEP_ORDER } from "~~/server/utils/video-pipeline-db"
import { executionOrderFor, stepsToRerunFrom } from "~~/server/utils/video-pipeline-run-policy"
import { assetTypesForSteps, STEP_ASSET_TYPES } from "~~/server/utils/video-pipeline-reset"

describe("шаг плана монтажа в порядке шагов", () => {
  it("новый ключ дописан в конец STEP_ORDER — история роликов не переписывается", () => {
    expect(STEP_ORDER[0]).toBe("prompt_generation")
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe("edit_plan")
  })

  it("на audio-first план монтажа идёт после транскрипции и до картинок", () => {
    const order = executionOrderFor(true)

    expect(order.indexOf("transcription")).toBeLessThan(order.indexOf("edit_plan"))
    expect(order.indexOf("edit_plan")).toBeLessThan(order.indexOf("image_generation"))
  })

  it("на старом маршруте шага нет вовсе", () => {
    expect(executionOrderFor(false)).not.toContain("edit_plan")
  })

  it("перезапуск транскрипции сбрасывает план монтажа", () => {
    expect(stepsToRerunFrom("transcription", true)).toContain("edit_plan")
  })

  it("перезапуск плана не трогает транскрипцию — она уже оплачена", () => {
    const steps = stepsToRerunFrom("edit_plan", true)

    expect(steps).not.toContain("transcription")
    expect(steps).not.toContain("voiceover_generation")
    expect(steps[0]).toBe("edit_plan")
  })

  it("у шага нет своих ассетов — кадры живут в таблице VideoShot", () => {
    expect(STEP_ASSET_TYPES.edit_plan).toEqual([])
    expect(assetTypesForSteps(["edit_plan"])).toEqual([])
  })
})
