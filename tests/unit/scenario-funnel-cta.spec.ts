/**
 * Unit-тесты CTA-проверок под воронку с кодовым словом.
 *
 * Продукт заказчика не устанавливают — конверсия идёт через кодовое слово в
 * Direct (docs/PROJECT_CONTEXT.md, п.9): комментарий с кодовым словом →
 * автоматизация Direct → Telegram → лид-магнит → форма/CRM. Требование
 * «назови приложение и позови его скачать» — наследие VideoCamp, для такой
 * воронки оно бессмысленно.
 *
 * Правило: есть воронка → проверяем кодовое слово, нет воронки → прежнее
 * поведение про имя приложения.
 */
import { describe, it, expect } from "vitest"
import { evaluateMarketingChecks } from "../../server/utils/agents/scenario-marketing-validator"
import type { StoryPlan } from "../../shared/types/story"

function planWith(finalLine: string, midLine = "Обычная сцена без призыва"): StoryPlan {
  return {
    scenes: [
      { order: 1, subtitleCopy: midLine, voiceoverLine: midLine },
      { order: 2, subtitleCopy: finalLine, voiceoverLine: finalLine },
    ],
  } as unknown as StoryPlan
}

const APP = { name: "Реформа", language: "ru" }
const FUNNEL = { keyword: "РАЦИОН" }

describe("воронка с кодовым словом", () => {
  it("пропускает сценарий, который зовёт написать кодовое слово", () => {
    const issues = evaluateMarketingChecks(
      planWith("Напиши слово РАЦИОН в директ — пришлю разбор"),
      "Напиши РАЦИОН в директ",
      { ...APP, funnel: FUNNEL },
    )

    expect(issues.filter(i => i.blocking)).toEqual([])
  })

  it("не требует имени продукта в кадре — продукт не устанавливают", () => {
    const issues = evaluateMarketingChecks(
      planWith("Напиши РАЦИОН в комментарии, и я отправлю список"),
      "Напиши РАЦИОН в комментарии",
      { ...APP, funnel: FUNNEL },
    )

    expect(issues.map(i => i.code)).not.toContain("no_mid_scene_app_mention")
    expect(issues.map(i => i.code)).not.toContain("cta_missing_app_name")
  })

  it("ловит сценарий без кодового слова", () => {
    const issues = evaluateMarketingChecks(
      planWith("Подписывайся, чтобы не потерять"),
      "Подписывайся",
      { ...APP, funnel: FUNNEL },
    )

    const codes = issues.filter(i => i.blocking).map(i => i.code)
    expect(codes).toContain("cta_missing_keyword")
    expect(codes).toContain("final_scene_not_keyword_cta")
  })

  it("ловит кодовое слово без призыва его отправить", () => {
    const issues = evaluateMarketingChecks(
      planWith("РАЦИОН — так называется мой разбор"),
      "РАЦИОН",
      { ...APP, funnel: FUNNEL },
    )

    expect(issues.filter(i => i.blocking).map(i => i.code)).toContain("final_scene_not_keyword_cta")
  })

  it("не зависит от регистра кодового слова", () => {
    const issues = evaluateMarketingChecks(
      planWith("напиши рацион в директ"),
      "напиши рацион в директ",
      { ...APP, funnel: FUNNEL },
    )

    expect(issues.filter(i => i.blocking)).toEqual([])
  })
})

describe("юнит без воронки — прежнее поведение", () => {
  it("по-прежнему требует имя приложения и призыв установить", () => {
    const issues = evaluateMarketingChecks(
      planWith("Спасибо за просмотр"),
      "Спасибо за просмотр",
      APP,
    )

    const codes = issues.filter(i => i.blocking).map(i => i.code)
    expect(codes).toContain("cta_missing_app_name")
    expect(codes).toContain("final_scene_not_cta_shaped")
  })

  it("пропускает корректный app-сценарий", () => {
    const issues = evaluateMarketingChecks(
      planWith("Скачай Реформа и начни сегодня", "В Реформа это считается автоматически"),
      "Скачай Реформа",
      APP,
    )

    expect(issues.filter(i => i.blocking)).toEqual([])
  })
})
