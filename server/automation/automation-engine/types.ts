/**
 * AutomationEngine — серверный интерфейс слоя автоматизации постинга.
 *
 * Каркас под Этап 3 миграции на DuoPlus (облачный Android cloud phone, канал
 * ADB/REST). Старый постинг шёл через CDP/WebDriver браузер-сессию + web-DOM
 * постеры; они выпиливаются в PR3. Эта абстракция изолирует FSM/poster-runner
 * от конкретного транспорта автоматизации.
 *
 * Этап 2: только интерфейс + NotImplementedAutomationEngine (см.
 * not-implemented-engine.ts), который бросает `engine_not_implemented`.
 *
 * Две будущие реализации (Этап 3 — здесь НЕ пишем):
 *   - AdbAutomationEngine    — собственный движок поверх ADB/Appium.
 *   - DuoplusRpaEngine       — враппер встроенного RPA-конструктора DuoPlus.
 *
 * Реальные device-level методы (powerOn / powerOff / pushMedia / screencap)
 * добавятся в Этапе 3, когда будет известен точный API DuoPlus. Здесь —
 * минимальный каркас, достаточный для подмены web-постинга на заглушку.
 *
 * Переиспользуем нейтральные контракты PostInput/PostResult из posters/types.ts
 * (их FSM/poster-runner уже знает; в PR3 из них вырежется web-специфика).
 */

import type { PostInput, PostResult } from "../posters/types"

export interface AutomationEngine {
  /** Идентификатор движка для логов/диагностики (напр. "not_implemented", "adb", "duoplus_rpa"). */
  readonly kind: string

  /** Опубликовать видео через движок автоматизации. */
  postVideo(input: PostInput): Promise<PostResult>
}
