/**
 * Diagnostic capture сессии постинга — ЗАГЛУШКА под Этап 3 (DuoPlus).
 *
 * Концепт «снять состояние сессии для post-mortem» валиден и переедет на Этап 3
 * (screencap Android-устройства через ADB + дамп текущего экрана). Прежняя
 * реализация снимала PNG/HTML/JSON через CDP/WebDriver browser-session, который
 * выпилен в PR3 (DuoPlus = облачный Android, у него нет браузерной сессии).
 *
 * Сигнатуры экспортов сохранены, чтобы будущий device-движок переиспользовал
 * контракт без правки call-sites. Тело — no-op: возвращает пустой результат,
 * никогда не бросает (diagnostic не должен ломать обработку ошибок постинга).
 *
 * GCS-префикс zavodcamp/posting-errors/ зарезервирован под Этап 3.
 */

import type { PostingPhase } from "./posters/types"

const SCREENSHOT_PREFIX = "zavodcamp/posting-errors/"

/**
 * Нейтральный handle сессии-источника снимка. На Этапе 2 — пустой плейсхолдер
 * (browser-session удалён). На Этапе 3 здесь будет device/ADB-handle.
 */
export type CaptureSessionSource = unknown

export interface CaptureSessionStateOpts {
  session: CaptureSessionSource
  jobId: string
  phase: PostingPhase
  /** Доп. label для различия нескольких snapshots в одной phase. */
  label: string
  fullPage?: boolean
}

export interface CaptureSessionStateResult {
  pngKey: string | null
  htmlKey: string | null
  metaKey: string | null
  errors: {
    png?: string
    html?: string
    meta?: string
    pageState?: string
  }
}

/** Резервный префикс GCS для Этапа 3 (экспорт для будущего device-движка). */
export const POSTING_ERROR_SCREENSHOT_PREFIX = SCREENSHOT_PREFIX

/**
 * ЗАГЛУШКА: захват состояния сессии не реализован на Этапе 2 (browser-session
 * удалён). Never throws. Возвращает пустой результат с пометкой в errors.
 */
export async function captureSessionState(
  _opts: CaptureSessionStateOpts,
): Promise<CaptureSessionStateResult> {
  return {
    pngKey: null,
    htmlKey: null,
    metaKey: null,
    errors: { meta: "capture_not_implemented_stage2_duoplus" },
  }
}

export interface CaptureErrorScreenshotOpts {
  session: CaptureSessionSource
  jobId: string
  phase: PostingPhase
  fullPage?: boolean
}

/** ЗАГЛУШКА: см. captureSessionState. Возвращает null (нет снимка). */
export async function captureErrorScreenshot(
  _opts: CaptureErrorScreenshotOpts,
): Promise<string | null> {
  return null
}

/**
 * ЗАГЛУШКА: pre-emptive capture не активен на Этапе 2. Возвращает no-op cancel,
 * чтобы call-sites с `finally { cancel() }` оставались корректными.
 */
export function schedulePreemptiveCapture(_opts: {
  session: CaptureSessionSource
  jobId: string
  phase: PostingPhase
  label: string
  preemptiveAtMs: number
}): { cancel: () => void } {
  return { cancel: () => {} }
}
