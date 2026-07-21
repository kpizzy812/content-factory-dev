/**
 * PhaseRunner для YouTube posting — ЗАГЛУШКА под Этап 3 (DuoPlus).
 *
 * Прежде под флагом YOUTUBE_POSTING_FSM_ENABLED poster-runner вызывал этот runner
 * вместо линейного postToYouTube; он итерировал Studio-фазы через web-DOM-функции
 * youtube-poster (navigate/upload/fill_details/publish) + resume_check по
 * draftVideoId. Весь web-DOM-слой (browser-session + posters) выпилен в PR3
 * (DuoPlus = облачный Android, у него нет YouTube Studio desktop-веба).
 *
 * Этап 2: тело фаз удалено, сигнатура runYouTubeStudioPhases сохранена (FSM-каркас
 * / poster-runner её зовёт). Бросает engine_not_implemented (обёрнут в
 * PostingPhaseError, terminalReason=requires_human) — осознанный feature-freeze
 * браузерного постинга до реализации device-движка (Этап 3 переписывает фазы под
 * ADB/RPA).
 *
 * Resume/duplicate-guard наработки (draftVideoId, verify_only) — web-специфичны и
 * НЕ переносятся на Android; Этап 3 строит dedup заново.
 */

import { AutomationEngineNotImplementedError } from "../../automation/automation-engine/not-implemented-engine"
import {
  PostingPhaseError,
  type PostInput,
  type PostResult,
} from "../../automation/posters/types"
import { appendJobLog } from "./job-service"

/**
 * ЗАГЛУШКА YouTube-фаз постинга. Бросает terminal engine_not_implemented.
 *
 * @throws PostingPhaseError (terminalReason='requires_human').
 */
export async function runYouTubeStudioPhases(input: PostInput): Promise<PostResult> {
  await appendJobLog(
    input.jobId,
    "warn",
    "youtube_fsm: фазовый runner заморожен до Этапа 3 (DuoPlus engine_not_implemented)",
    { platform: input.platform, reason: "engine_not_implemented" },
  )
  const err = new AutomationEngineNotImplementedError(
    "YouTube post: фазовый runner не реализован (DuoPlus — Этап 3).",
  )
  throw new PostingPhaseError(
    err.message,
    "session_start",
    "unknown",
    undefined,
    "requires_human",
  )
}
