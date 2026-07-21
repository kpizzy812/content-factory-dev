/**
 * PhaseRunner для Instagram (Reels) posting — ЗАГЛУШКА под Этап 3 (DuoPlus).
 *
 * Прежде под флагом INSTAGRAM_POSTING_FSM_ENABLED poster-runner вызывал этот
 * runner вместо линейного postToInstagram; он итерировал IG desktop-веб-флоу
 * (open create → select file → crop → edit → caption → share → verify) через
 * web-DOM-функции instagram-poster + консервативный resume по shortcode. Весь
 * web-DOM-слой (browser-session + posters + resume-policy-instagram) выпилен в
 * PR3 (DuoPlus = облачный Android, у него нет IG desktop-веба).
 *
 * Этап 2: тело фаз удалено, сигнатура runInstagramReelPhases сохранена (FSM-каркас
 * / poster-runner её зовёт). Бросает engine_not_implemented (обёрнут в
 * PostingPhaseError, terminalReason=requires_human) — осознанный feature-freeze
 * браузерного постинга до реализации device-движка (Этап 3).
 *
 * @see posting-fsm.ts (YouTube-аналог).
 */

import { AutomationEngineNotImplementedError } from "../../automation/automation-engine/not-implemented-engine"
import {
  PostingPhaseError,
  type PostInput,
  type PostResult,
} from "../../automation/posters/types"
import { appendJobLog } from "./job-service"

/**
 * STALE-окно профиль-верификации (нейтральная env-функция, сохранена для Этапа 3).
 * Override через INSTAGRAM_VERIFY_STALE_MS; дефолт 15 мин.
 */
export function resolveVerifyStaleMs(): number {
  const raw = process.env.INSTAGRAM_VERIFY_STALE_MS
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000
}

/**
 * ЗАГЛУШКА Instagram-фаз постинга. Бросает terminal engine_not_implemented.
 *
 * @throws PostingPhaseError (terminalReason='requires_human').
 */
export async function runInstagramReelPhases(input: PostInput): Promise<PostResult> {
  await appendJobLog(
    input.jobId,
    "warn",
    "instagram_fsm: фазовый runner заморожен до Этапа 3 (DuoPlus engine_not_implemented)",
    { platform: input.platform, reason: "engine_not_implemented" },
  )
  const err = new AutomationEngineNotImplementedError(
    "Instagram Reel: фазовый runner не реализован (DuoPlus — Этап 3).",
  )
  throw new PostingPhaseError(
    err.message,
    "session_start",
    "unknown",
    undefined,
    "requires_human",
  )
}
