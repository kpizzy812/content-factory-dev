import { describe, expect, it } from "vitest"

import { decideVideoRoute, resolveEditPipelineFlag } from "~~/server/utils/video-pipeline-run-policy"

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

/**
 * `decideVideoRoute` — чистая часть `resolveVideoRoute` (`video-pipeline.ts`):
 * тот же исход, что решает реальный пайплайн, без похода в БД/реестр. Ей же
 * обязана пользоваться смета ролика (`estimateVideoCost` через `video-cost.ts`
 * и `estimate-cost.post.ts`) — иначе смета и факт расходятся именно там, где
 * EDIT_PIPELINE включён, а модель транскрипции не настроена.
 */
describe("decideVideoRoute — тот же исход, что resolveVideoRoute", () => {
  it("EDIT_PIPELINE выключен — старый маршрут независимо от остального", () => {
    expect(decideVideoRoute({
      editPipeline: false,
      transcriptionRouteAvailable: true,
      audioFirstTrackExists: true,
    })).toEqual({ kind: "route", audioFirst: false })
  })

  it("EDIT_PIPELINE включён и модель транскрипции настроена — audio-first", () => {
    expect(decideVideoRoute({
      editPipeline: true,
      transcriptionRouteAvailable: true,
      audioFirstTrackExists: false,
    })).toEqual({ kind: "route", audioFirst: true })
  })

  it("EDIT_PIPELINE включён, модели нет, трека тоже нет — деградация на старый маршрут, а НЕ audioFirst:true по сырому флагу", () => {
    // Это и есть та мутация, которую смета обязана отличать: сырой
    // video.editPipeline=true НЕ означает audioFirst=true, если модель
    // транскрипции недоступна — ролик уйдёт прежним маршрутом целиком (§10).
    expect(decideVideoRoute({
      editPipeline: true,
      transcriptionRouteAvailable: false,
      audioFirstTrackExists: false,
    })).toEqual({ kind: "route", audioFirst: false })
  })

  it("EDIT_PIPELINE включён, модели нет, но трек уже синтезирован — конфликт, не тихая деградация", () => {
    expect(decideVideoRoute({
      editPipeline: true,
      transcriptionRouteAvailable: false,
      audioFirstTrackExists: true,
    })).toEqual({ kind: "conflict" })
  })
})
