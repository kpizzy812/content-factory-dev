/**
 * Чистый policy-движок возобновления posting-job после browser_lost/duplicate_risk
 * (PR4 duplicate-upload guard).
 *
 * resolveResumePlan(stateData) → ResumePlan — единственное решение «как продолжать
 * этот job на retry, чтобы НЕ создать дубль на YouTube». Pure: на вход только
 * stateData (progress / draftVideoId / duplicateRiskAcknowledged), на выход — план.
 * Браузерные шаги (открыть draft edit URL, проверить опубликовано ли) исполняет
 * runner/youtube-poster — здесь только декларативное решение.
 *
 * КОНСЕРВАТИВНОЕ design-решение (§10.4 handoff): надёжный resume возможен ТОЛЬКО
 * по draftVideoId. Скан Studio-черновиков по title хрупкий и НЕ валидируется на
 * проде (Indigo dead-port блокер) — неверный match создаст дубль / возьмёт не тот
 * draft. Поэтому при неуверенности (upload пошёл, но draftVideoId не захвачен, ИЛИ
 * единственный bounded re-upload уже израсходован) → block (duplicate_blocked),
 * а не риск. Полный title-scan — возможный follow-up, не PR4.
 *
 * Дерево решений (приоритет сверху вниз — самое опасное первым):
 *   1. progress>=publish_clicked        → verify_only (Publish мог сработать —
 *                                          НИКОГДА не кликать снова, только проверить).
 *   2. draftVideoId есть                → resume_from_details (сильнейший dedup-ключ:
 *                                          открыть draft, дозаполнить, БЕЗ re-upload).
 *   3. progress<file_attached_unconfirmed → fresh (ничего не прикреплено — безопасно).
 *   4. progress==file_attached_unconfirmed, нет draft:
 *        - duplicateRiskAcknowledged=false → reupload_once (один bounded re-upload);
 *        - true                            → duplicate_blocked (re-upload израсходован).
 *   5. progress>=upload_started, нет draft → duplicate_blocked (файл точно пошёл,
 *                                          dedup-ключа нет — слепой re-upload = дубль).
 *
 * @see shared/types/youtube-posting-fsm.ts (ResumePlan), phase-policy.ts (getProgressRetryPolicy)
 * @see docs/architecture/youtube-posting-fsm.md
 */

import {
  YOUTUBE_POSTING_PROGRESS_ORDER,
  type ResumePlan,
  type YouTubePostingProgress,
  type YouTubePostingStateData,
} from "../../../shared/types/youtube-posting-fsm"

function progressIndex(p: YouTubePostingProgress): number {
  return YOUTUBE_POSTING_PROGRESS_ORDER.indexOf(p)
}

const ATTACH_IDX = progressIndex("file_attached_unconfirmed")
const PUBLISH_CLICKED_IDX = progressIndex("publish_clicked")

/**
 * Решить план возобновления по persisted stateData. Pure, без браузера/БД.
 * Защитно: отсутствующий progress трактуется как file_not_attached (fresh).
 */
export function resolveResumePlan(stateData: YouTubePostingStateData): ResumePlan {
  const idx = progressIndex(stateData.progress ?? "file_not_attached")

  // 1. Publish уже кликнут — пост мог опубликоваться. Только verify, без republish.
  if (idx >= PUBLISH_CLICKED_IDX) return "verify_only"

  // 2. Есть draftVideoId — сильнейший dedup-ключ. Возобновляем с draft, без re-upload.
  if (stateData.draftVideoId) return "resume_from_details"

  // 3. Ничего не прикреплено — обычный прогон безопасен.
  if (idx < ATTACH_IDX) return "fresh"

  // 4. Файл прикреплён, но без подтверждения и без захваченного draftVideoId.
  if (idx === ATTACH_IDX) {
    return stateData.duplicateRiskAcknowledged ? "duplicate_blocked" : "reupload_once"
  }

  // 5. Upload точно пошёл (>=upload_started), но draftVideoId нет — dedup невозможен.
  return "duplicate_blocked"
}

/**
 * true — план разрешает (повторную) загрузку файла. fresh — обычная загрузка,
 * reupload_once — один bounded re-upload. resume_from_details/verify_only —
 * загрузка ЗАПРЕЩЕНА (работаем с существующим draft / только проверяем).
 * duplicate_blocked — загрузка запрещена (терминальный риск дубля).
 */
export function resumeAllowsUpload(plan: ResumePlan): boolean {
  return plan === "fresh" || plan === "reupload_once"
}

/**
 * Решение по застрявшему в uploading job'у (PR4 stuck-uploading recovery, worker).
 *   skip           — не трогать (non-FSM / нет heartbeat / heartbeat свежий);
 *   retry_resume   — progress < publish_clicked → retry_queued, на след. заходе
 *                    runner ОБЯЗАН пройти resume_check (duplicate-guard);
 *   requires_human — progress >= publish_clicked → failed, БЕЗ retry/republish
 *                    (Publish мог сработать — нужна ручная проверка).
 */
export type StuckUploadingAction = "skip" | "retry_resume" | "requires_human"

/**
 * Pure-решение stuck-uploading recovery. Без БД/Date.now — `now` и `limitMs`
 * передаёт worker. Только для FSM-job (stateData.fsmVersion). Отсутствие/битый
 * lastTransitionAt → skip (не трогаем legacy/битые данные, PR4 п.4).
 */
export function resolveStuckUploadingAction(
  stateData: YouTubePostingStateData | null,
  now: Date,
  limitMs: number,
): StuckUploadingAction {
  if (!stateData || typeof stateData.fsmVersion !== "number") return "skip"
  if (!stateData.lastTransitionAt) return "skip"
  const lastMs = new Date(stateData.lastTransitionAt).getTime()
  if (Number.isNaN(lastMs)) return "skip"
  if (now.getTime() - lastMs < limitMs) return "skip"
  const progress = stateData.progress ?? "file_not_attached"
  const afterPublish =
    YOUTUBE_POSTING_PROGRESS_ORDER.indexOf(progress)
    >= YOUTUBE_POSTING_PROGRESS_ORDER.indexOf("publish_clicked")
  return afterPublish ? "requires_human" : "retry_resume"
}
