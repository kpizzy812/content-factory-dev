/**
 * Unit-тесты структуры ролика под воронку с лид-магнитом.
 *
 * Замер первого рабочего сценария: 22 секунды, из них полезной информации одна
 * сцена из пяти. Остальное — личная история и появление продукта как точки
 * перелома. Для инфопродукта это провал: зритель не получил повода отправить
 * кодовое слово, а по ТЗ ролик должен идти 70-90 секунд.
 */
import { describe, it, expect } from "vitest"
import { resolveSceneCountStrategy } from "../../server/utils/agents/scenario-pipeline"

describe("resolveSceneCountStrategy", () => {
  it("для воронки берёт длинный формат — 72-90 секунд по ТЗ", () => {
    expect(resolveSceneCountStrategy(null, { keyword: "РАЦИОН" })).toBe("longform")
  })

  it("без воронки оставляет прежний auto", () => {
    expect(resolveSceneCountStrategy(null, null)).toBe("auto")
  })

  it("явный выбор оператора важнее умолчания", () => {
    expect(
      resolveSceneCountStrategy({ sceneCountStrategy: "minimal" }, { keyword: "РАЦИОН" }),
    ).toBe("minimal")
  })

  it("пустые настройки профиля не считаются выбором", () => {
    expect(
      resolveSceneCountStrategy({ sceneCountStrategy: undefined }, { keyword: "РАЦИОН" }),
    ).toBe("longform")
  })
})
