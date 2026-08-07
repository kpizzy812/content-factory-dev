/**
 * Регрессия: учёт стоимости повторных прогонов шага видео.
 *
 * Дефект: дедуп ledger был вечным по (videoId, stepKey, service), из-за чего
 * реальный rerun шага (деньги у провайдера списаны второй раз) в ledger не попадал.
 *
 * Здесь проверяем чистую часть фикса — сборку условия дедупа. Запись в БД
 * покрыта интеграционным tests/unit/balance-cost-ledger.spec.ts.
 */

import { describe, it, expect } from "vitest"
import {
  buildStepCostDedupeWhere,
  normalizeCostAttempt,
} from "../../../server/utils/balance/cost-ledger"

describe("normalizeCostAttempt", () => {
  it("мусор и отсутствие значения считаем первой попыткой", () => {
    expect(normalizeCostAttempt(undefined)).toBe(1)
    expect(normalizeCostAttempt(null)).toBe(1)
    expect(normalizeCostAttempt(0)).toBe(1)
    expect(normalizeCostAttempt(-5)).toBe(1)
    expect(normalizeCostAttempt(Number.NaN)).toBe(1)
    expect(normalizeCostAttempt(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it("дробный номер округляет вниз до целого", () => {
    expect(normalizeCostAttempt(1.9)).toBe(1)
    expect(normalizeCostAttempt(3.4)).toBe(3)
  })

  it("нормальные номера попыток проходят как есть", () => {
    expect(normalizeCostAttempt(1)).toBe(1)
    expect(normalizeCostAttempt(2)).toBe(2)
    expect(normalizeCostAttempt(17)).toBe(17)
  })
})

describe("buildStepCostDedupeWhere", () => {
  it("первая попытка — старое поведение: только stepKey + service, без Json-фильтра", () => {
    const where = buildStepCostDedupeWhere("image_generation", "fal.ai")
    expect(where).toEqual({ stepKey: "image_generation", service: "fal.ai" })
    expect(where.suggestions).toBeUndefined()
  })

  it("attempt=1 эквивалентен отсутствию attempt (исторические строки без метаданной находятся)", () => {
    expect(buildStepCostDedupeWhere("clip_generation", "fal.ai", 1)).toEqual(
      buildStepCostDedupeWhere("clip_generation", "fal.ai"),
    )
  })

  it("повторная попытка сужает дедуп до строки этой же попытки", () => {
    const where = buildStepCostDedupeWhere("clip_generation", "fal.ai", 2)
    expect(where).toEqual({
      stepKey: "clip_generation",
      service: "fal.ai",
      suggestions: { path: ["attempt"], equals: 2 },
    })
  })

  it("разные попытки дают разные условия — вторая не находит строку первой", () => {
    const second = buildStepCostDedupeWhere("lip_sync_generation", "replicate", 2)
    const third = buildStepCostDedupeWhere("lip_sync_generation", "replicate", 3)
    expect(second.suggestions?.equals).toBe(2)
    expect(third.suggestions?.equals).toBe(3)
    expect(second).not.toEqual(third)
  })

  it("мусорный attempt не превращается в отдельную строку ledger", () => {
    // Иначе кривой вызов начал бы плодить дубли расхода на ровном месте.
    expect(buildStepCostDedupeWhere("music_generation", "mubert", 0)).toEqual({
      stepKey: "music_generation",
      service: "mubert",
    })
    expect(buildStepCostDedupeWhere("music_generation", "mubert", Number.NaN)).toEqual({
      stepKey: "music_generation",
      service: "mubert",
    })
  })
})
