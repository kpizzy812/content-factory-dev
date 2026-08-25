import { describe, expect, it } from "vitest"

import { sceneMediaNeeded } from "~~/server/utils/video-pipeline-run-policy"

describe("нужны ли посценные картинки и клипы", () => {
  it("старый маршрут — нужны всегда, что бы ни лежало в кадрах", () => {
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: false, shotCount: 0 })).toBe(true)
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: false, shotCount: 40 })).toBe(true)
  })

  it("трек состоялся и кадры есть — посценные шаги не нужны: их продукт в ролик не попадает", () => {
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: true, shotCount: 40 })).toBe(false)
  })

  it("трек состоялся, а кадров нет — нужны: собирать будет нечего", () => {
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: true, shotCount: 0 })).toBe(true)
  })

  it("решение опирается на ФАКТ трека, а не на флаг ролика", () => {
    // Ролик с включённым EDIT_PIPELINE, у которого трек не синтезировался
    // (empty_script, legacy_mode_no_single_track), обязан идти прежним путём.
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: false, shotCount: 40 })).toBe(true)
  })
})
