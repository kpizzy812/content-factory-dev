import { describe, expect, it } from "vitest"

import { STEP_ORDER } from "~~/server/utils/video-pipeline-db"
import { executionOrderFor, stepsToRerunFrom } from "~~/server/utils/video-pipeline-run-policy"
import { assetTypesForSteps } from "~~/server/utils/video-pipeline-reset"

describe("порядок шагов на маршруте audio-first", () => {
  it("новый ключ дописан в конец STEP_ORDER — история роликов не переписывается", () => {
    expect(STEP_ORDER[0]).toBe("prompt_generation")
    // Задача 5 дописала "edit_plan" ПОСЛЕ "transcription" тем же приёмом —
    // последний элемент STEP_ORDER снова сдвинулся, сама transcription в
    // персистентном порядке осталась на своём месте.
    expect(STEP_ORDER[STEP_ORDER.length - 2]).toBe("transcription")
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe("edit_plan")
  })

  it("на новом маршруте озвучка идёт до транскрипции, а та — до клипов", () => {
    const order = executionOrderFor(true)

    expect(order.indexOf("voiceover_generation")).toBeLessThan(order.indexOf("transcription"))
    expect(order.indexOf("transcription")).toBeLessThan(order.indexOf("clip_generation"))
    expect(order.indexOf("clip_generation")).toBeLessThan(order.indexOf("lip_sync_generation"))
    // Озвучка и транскрипция стоят ДО картинки — раньше это проверял отдельный
    // planPipelineRun(true) (удалён вместе с обёрткой, executionOrderFor и есть
    // единственный источник порядка).
    expect(order.indexOf("voiceover_generation")).toBeLessThan(order.indexOf("image_generation"))
    expect(order.indexOf("transcription")).toBeLessThan(order.indexOf("image_generation"))
  })

  it("на старом маршруте порядок прежний — недоделанные ролики доживают по своим правилам", () => {
    expect(executionOrderFor(false)).toEqual([
      "prompt_generation",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "voiceover_generation",
      "music_generation",
      "assembly",
    ])
  })

  it("перезапуск озвучки на новом маршруте сбрасывает транскрипцию", () => {
    const steps = stepsToRerunFrom("voiceover_generation", true)

    expect(steps).toContain("transcription")
    expect(steps).toContain("assembly")
  })

  it("перезапуск транскрипции не трогает саму озвучку — она уже оплачена", () => {
    const steps = stepsToRerunFrom("transcription", true)

    expect(steps).not.toContain("voiceover_generation")
    expect(steps[0]).toBe("transcription")
  })

  it("сброс транскрипции сносит её ассет", () => {
    expect(assetTypesForSteps(["transcription"])).toEqual(["transcript"])
  })
})
