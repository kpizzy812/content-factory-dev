/**
 * Библиотека портретов из одного референса.
 *
 * Этап 5 спецификации docs/superpowers/specs/2026-08-14-avatar-pipeline.md.
 * Ротация портретов (`server/utils/avatar-source.ts`) размазывает нагрузку по
 * кадрам персонажа — но только если кадров несколько. Сегодня их приносит
 * заказчик: 5-10 фотографий человека. Вариации снимают это требование.
 */

import { describe, expect, it } from "vitest"
import {
  MAX_REFERENCE_VARIATIONS,
  REFERENCE_VARIATION_PRESETS,
  buildVariationIdentityScope,
  buildVariationPrompt,
  planReferenceVariations,
} from "../../../server/utils/character-reference-variations"
import { pickAvatarPortrait } from "../../../server/utils/avatar-source"

describe("пресеты вариаций", () => {
  it("меняют ракурс, одежду, обстановку и свет", () => {
    const axes = new Set(REFERENCE_VARIATION_PRESETS.map(preset => preset.axis))
    expect(axes).toEqual(new Set(["angle", "outfit", "setting", "light"]))
  })

  it("все вариации остаются портретами лица", () => {
    // Ротация ставит kind="face" впереди любого другого кадра
    // (`compareAvatarPortraits`): вариация с kind="body" никогда не будет
    // выбрана, пока у персонажа есть хоть один портрет лица. То есть кадр не
    // в kind="face" — это кадр мимо ротации, ради которой всё и делается.
    for (const preset of REFERENCE_VARIATION_PRESETS) {
      expect(preset.kind).toBe("face")
    }
  })

  it("ключи пресетов уникальны", () => {
    const keys = REFERENCE_VARIATION_PRESETS.map(preset => preset.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("buildVariationPrompt", () => {
  it("сначала требует сохранить человека, потом правит кадр", () => {
    // Kontext — инструкция правки, а не описание с нуля. Без явного «тот же
    // человек» модель рисует похожего, и библиотека портретов наполняется
    // незнакомцами.
    const preset = REFERENCE_VARIATION_PRESETS[0]!
    const prompt = buildVariationPrompt(preset)
    expect(prompt.toLowerCase()).toContain("same person")
    expect(prompt).toContain(preset.instruction)
  })

  it("держит лицо и рот в кадре", () => {
    // Портрет уходит в speech_to_video, где губы синхронизируются с речью:
    // кадр со спины или в полный профиль там бесполезен.
    for (const preset of REFERENCE_VARIATION_PRESETS) {
      expect(buildVariationPrompt(preset).toLowerCase()).toContain("mouth")
    }
  })

  it("заметка оператора добавляется, а не заменяет инструкцию", () => {
    const preset = REFERENCE_VARIATION_PRESETS[0]!
    const prompt = buildVariationPrompt(preset, "no glasses")
    expect(prompt).toContain(preset.instruction)
    expect(prompt).toContain("no glasses")
  })

  it("пустая заметка ничего не добавляет", () => {
    const preset = REFERENCE_VARIATION_PRESETS[0]!
    expect(buildVariationPrompt(preset, "   ")).toBe(buildVariationPrompt(preset))
  })
})

describe("planReferenceVariations", () => {
  it("возвращает разные пресеты, пока они не кончились", () => {
    const plan = planReferenceVariations(4)
    expect(plan).toHaveLength(4)
    expect(new Set(plan.map(preset => preset.key)).size).toBe(4)
  })

  it("смещение продолжает набор, а не повторяет начало", () => {
    // Второй запуск для того же персонажа должен дать новые ракурсы:
    // иначе оператор платит за те же четыре кадра ещё раз.
    const first = planReferenceVariations(3)
    const second = planReferenceVariations(3, { startIndex: 3 })
    expect(second.map(p => p.key)).not.toEqual(first.map(p => p.key))
  })

  it("больше потолка за раз не отдаёт", () => {
    // Кадр стоит $0.025; без потолка одна опечатка в поле «сколько» —
    // это счёт на десятки долларов.
    expect(() => planReferenceVariations(MAX_REFERENCE_VARIATIONS + 1)).toThrow()
    expect(() => planReferenceVariations(0)).toThrow()
    expect(() => planReferenceVariations(1.5)).toThrow()
  })

  it("потолок не больше числа пресетов", () => {
    expect(MAX_REFERENCE_VARIATIONS).toBeLessThanOrEqual(REFERENCE_VARIATION_PRESETS.length)
  })
})

describe("buildVariationIdentityScope", () => {
  it("область слота — исходный кадр плюс пресет", () => {
    // Повтор того же пресета на том же исходнике обязан переиспользовать уже
    // оплаченный результат, а не покупать его второй раз.
    expect(buildVariationIdentityScope("ref_1", "angle_three_quarter_left"))
      .toBe("character-reference:ref_1:variation:angle_three_quarter_left")
  })

  it("другой исходник — другая область", () => {
    expect(buildVariationIdentityScope("ref_1", "angle_three_quarter_left"))
      .not.toBe(buildVariationIdentityScope("ref_2", "angle_three_quarter_left"))
  })
})

describe("сгенерированные вариации попадают в ротацию", () => {
  it("свежая вариация опережает исходный портрет", () => {
    // Смысл этапа: исходник уже отработал в сценах, вариация ещё нет.
    const source = {
      id: "ref_1",
      kind: "face",
      order: 0,
      storageKey: "characters/ref_1.jpg",
      fileUrl: "https://files/ref_1.jpg",
      mimeType: "image/jpeg",
      usageCount: 4,
      lastUsedAt: new Date("2026-08-14T10:00:00Z"),
    }
    const variation = {
      ...source,
      id: "ref_1_var_angle",
      order: 1,
      storageKey: "characters/ref_1_var_angle.jpg",
      fileUrl: "https://files/ref_1_var_angle.jpg",
      usageCount: 0,
      lastUsedAt: null,
    }
    expect(pickAvatarPortrait([source, variation])?.id).toBe("ref_1_var_angle")
  })
})
