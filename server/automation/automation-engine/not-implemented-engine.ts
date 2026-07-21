/**
 * NotImplementedAutomationEngine — заглушка движка автоматизации на Этап 2.
 *
 * После выпиливания CDP/WebDriver-постинга (PR3) и до реализации DuoPlus-движка
 * (Этап 3) ветка browser_automation постинга не имеет живого транспорта. Этот
 * движок бросает структурированную terminal-ошибку `engine_not_implemented` —
 * НЕ для retry (повтор бессмыслен: реализации ещё нет, это осознанный
 * feature-freeze браузерного постинга, см. duoplus-stage2-neutralization-plan).
 *
 * Ошибка оформлена самодостаточным Error-классом в стиле PostingPhaseError
 * (code/terminal). Глубокая интеграция в error-taxonomy.ts/error-classifier.ts —
 * задача PR3; здесь модуль изолирован и ни от чего нового не зависит.
 */

import type { AutomationEngine } from "./types"
import type { PostInput, PostResult } from "../posters/types"

/** Код ошибки нереализованного движка — terminal, исключается из retry. */
export const ENGINE_NOT_IMPLEMENTED = "engine_not_implemented" as const

/**
 * Структурированная ошибка нереализованного движка автоматизации.
 * `terminal: true` — сигнал retry-policy, что повтор бессмыслен.
 */
export class AutomationEngineNotImplementedError extends Error {
  readonly code = ENGINE_NOT_IMPLEMENTED
  /** Повтор бессмыслен — движок ещё не реализован. */
  readonly terminal = true

  constructor(message = "Движок автоматизации не реализован (DuoPlus — Этап 3)") {
    super(message)
    this.name = "AutomationEngineNotImplementedError"
  }
}

/**
 * Движок-заглушка. Любой вызов метода постинга завершается terminal-ошибкой.
 * Используется poster-runner'ом в ветке browser_automation на Этапе 2.
 */
export class NotImplementedAutomationEngine implements AutomationEngine {
  readonly kind = "not_implemented"

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async postVideo(_input: PostInput): Promise<PostResult> {
    throw new AutomationEngineNotImplementedError()
  }
}
