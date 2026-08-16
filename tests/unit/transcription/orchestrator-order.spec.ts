import { describe, expect, it } from "vitest"

import { planPipelineRun } from "~~/server/utils/video-pipeline"

describe("план прогона оркестратора", () => {
  it("на audio-first озвучка и транскрипция идут до картинки", () => {
    const plan = planPipelineRun(true)

    expect(plan.indexOf("voiceover_generation")).toBeLessThan(plan.indexOf("image_generation"))
    expect(plan.indexOf("transcription")).toBeLessThan(plan.indexOf("image_generation"))
  })

  it("на старом маршруте план совпадает с историческим порядком", () => {
    expect(planPipelineRun(false)).toEqual([
      "prompt_generation",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "voiceover_generation",
      "music_generation",
      "assembly",
    ])
  })
})
