import { describe, expect, it } from "vitest"
import { moduleGate } from "../../server/utils/module-gate"

/**
 * Гейт модулей в агрегирующих эндпоинтах. Проверять его через живую базу
 * нельзя — пришлось бы менять права пользователя, — а ошибка здесь означает
 * утечку: сводка или палитра покажут объекты раздела, которого человек
 * не видит.
 */
describe("moduleGate", () => {
  it("пускает только в выданные модули", () => {
    const has = moduleGate({ canAdmin: false, moduleAccess: ["trendwatcher", "analytics"] })
    expect(has("trendwatcher")).toBe(true)
    expect(has("analytics")).toBe(true)
    expect(has("social-upload")).toBe(false)
    expect(has("video-generator")).toBe(false)
    expect(has("pipeline")).toBe(false)
  })

  it("администратор видит всё — он этими модулями и управляет", () => {
    const has = moduleGate({ canAdmin: true, moduleAccess: [] })
    for (const slug of ["trendwatcher", "script-generator", "video-generator", "social-upload", "analytics", "pipeline"]) {
      expect(has(slug), slug).toBe(true)
    }
  })

  it("отсутствие данных о правах закрывает доступ, а не открывает", () => {
    for (const user of [null, undefined, {}, { moduleAccess: null }, { canAdmin: false }]) {
      const has = moduleGate(user as never)
      expect(has("trendwatcher"), JSON.stringify(user)).toBe(false)
    }
  })

  it("canAdmin именно true, а не любое истинное значение", () => {
    // Флаг приходит из внешней системы: строка "false" не должна открыть всё.
    const has = moduleGate({ canAdmin: "false" as never, moduleAccess: [] })
    expect(has("pipeline")).toBe(false)
  })

  it("неизвестный слаг не проходит по совпадению префикса", () => {
    const has = moduleGate({ canAdmin: false, moduleAccess: ["social-upload"] })
    expect(has("social")).toBe(false)
    expect(has("social-upload-admin")).toBe(false)
  })
})
