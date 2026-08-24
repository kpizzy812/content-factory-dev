import { describe, expect, it } from "vitest"

import { STEP_ORDER as SERVER_STEP_ORDER } from "~~/server/utils/video-pipeline-db"
import { STEP_ASSET_TYPES } from "~~/server/utils/video-pipeline-reset"
import {
  STEP_EXECUTION_ORDER,
  STEP_EXECUTION_ORDER_AUDIO_FIRST,
  stepsToRerunFrom,
} from "~~/server/utils/video-pipeline-run-policy"
import { STEP_LABELS, STEP_ORDER as UI_STEP_ORDER } from "~~/shared/types/video"

describe("ключ шага shot_background разнесён по пайплайну", () => {
  it("дописан в КОНЕЦ персистентного STEP_ORDER — stepIndex уже записан историей", () => {
    expect(SERVER_STEP_ORDER.at(-1)).toBe("shot_background")
    // Позиции всех прежних ключей не изменились ни на единицу.
    expect(SERVER_STEP_ORDER.indexOf("assembly")).toBe(6)
    expect(SERVER_STEP_ORDER.indexOf("transcription")).toBe(7)
    expect(SERVER_STEP_ORDER.indexOf("edit_plan")).toBe(8)
  })

  it("в порядке ИСПОЛНЕНИЯ audio-first стоит сразу после edit_plan и до image_generation", () => {
    const order = STEP_EXECUTION_ORDER_AUDIO_FIRST
    expect(order.indexOf("shot_background")).toBe(order.indexOf("edit_plan") + 1)
    expect(order.indexOf("shot_background")).toBeLessThan(order.indexOf("image_generation"))
    expect(order.indexOf("shot_background")).toBeLessThan(order.indexOf("assembly"))
  })

  it("старого маршрута новый ключ не касается вовсе", () => {
    expect(STEP_EXECUTION_ORDER).not.toContain("shot_background")
  })

  it("перезапуск edit_plan тянет за собой фоны кадров, перезапуск фонов — не тянет план", () => {
    expect(stepsToRerunFrom("edit_plan", true)).toContain("shot_background")
    expect(stepsToRerunFrom("shot_background", true)).not.toContain("edit_plan")
    // Мутация «поставить shot_background ПЕРЕД edit_plan» краснит именно здесь.
    expect(stepsToRerunFrom("shot_background", true)).toContain("assembly")
  })

  it("каскад сброса сносит ассеты фонов кадров и только их", () => {
    expect(STEP_ASSET_TYPES.shot_background).toEqual(["shot_background"])
    // Кадры (VideoShot) чистит отдельная ветка — здесь их быть не должно.
    expect(STEP_ASSET_TYPES.edit_plan).toEqual([])
  })

  it("UI знает ярлык нового шага и рисует его после плана монтажа", () => {
    expect(STEP_LABELS.shot_background).toBe("Фоны кадров")
    expect(UI_STEP_ORDER.indexOf("shot_background")).toBe(UI_STEP_ORDER.indexOf("edit_plan") + 1)
  })
})
