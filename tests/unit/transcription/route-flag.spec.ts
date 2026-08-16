import { describe, expect, it } from "vitest"

import { resolveEditPipelineFlag } from "~~/server/utils/video-pipeline-run-policy"

describe("флаг маршрута производства", () => {
  it("выключен по умолчанию — старый маршрут основной до canary", () => {
    expect(resolveEditPipelineFlag({})).toBe(false)
  })

  it("включается явным значением", () => {
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "on" })).toBe(true)
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "true" })).toBe(true)
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "1" })).toBe(true)
  })

  it("не включается мусором", () => {
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "maybe" })).toBe(false)
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "" })).toBe(false)
  })
})
