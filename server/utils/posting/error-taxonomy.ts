/**
 * Чистый классификатор ошибок phase-level FSM (YouTube browser automation).
 *
 * Берёт message + phase + progress + login-context и возвращает один из 11
 * логических классов (YouTubePostingErrorClass) с disposition/retryable/terminal
 * и legacy persistedCategory. БЕЗ side-effects, БЕЗ БД, БЕЗ Nuxt/Prisma runtime.
 *
 * Fingerprints перенесены числом-в-число из текущего кода — это формализация,
 * не новая логика:
 *   - dead-port:     worker.ts:426-428
 *   - browser_lost:  worker.ts:534
 *   - auth_required: youtube-poster.ts:561-563 (classifyStudioProbe)
 *   - login_check:   poster-runner.ts:303-352
 *   - network:       error-classifier.ts:114-122
 *
 * ВАЖНО: PR1 — НЕ подключено к runtime. categorizeError (error-classifier.ts) и
 * worker.ts:handleFailure продолжают работать как раньше. Этот классификатор
 * включится в PR3 под флагом YOUTUBE_POSTING_FSM_ENABLED.
 *
 * proxy_dead вне scope: leak/proxy-сбой выставляется явно как PostingPhaseError
 * (category="proxy_dead") ДО любой эвристики и не входит в 11-классовый вокабуляр.
 *
 * @see docs/architecture/youtube-posting-fsm.md
 */

import type { PostingErrorCategory } from "../../../shared/types/posting-job"
import {
  YOUTUBE_POSTING_PROGRESS_ORDER,
  type YouTubePostingErrorClass,
  type YouTubePostingPhase,
  type YouTubePostingProgress,
} from "../../../shared/types/youtube-posting-fsm"
import { getClassRetryPolicy } from "./phase-policy"

// ---- fingerprints (числом-в-число из текущего кода) ----

/** captcha / verify it's you / phone challenge / 2-step — авто-постинг невозможен. */
const REQUIRES_HUMAN_RE =
  /captcha|verify\s*it'?s\s*you|verify\s*your|confirm\s*you'?re\s*not\s*a\s*robot|phone\s*(number|verification|challenge)|2-?step|two-?step|подтверд(ите|ить)[^.]*(телефон|личност)|необычн(ый|ая)\s*вход/i

/** dead-port: Indigo отдал port, но CDP не открылся (worker.ts:426-428). Экспорт для retry-policy (PR3) — единый источник fingerprint'а. */
export const DEAD_PORT_RE = /DevTools endpoint not ready|Unable to connect|не отдал рабочий CDP-порт/i

/** browser/page умер внутри pipeline (worker.ts:534). Экспорт для retry-policy (PR3). */
export const BROWSER_LOST_RE =
  /Attempted to use detached Frame|detached Frame|Target closed|Session closed|Execution context was destroyed/i

/** redirect на Google Sign-In после navigate (youtube-poster.ts:561-563). */
const AUTH_REQUIRED_RE = /accounts\.google\.com|(sign\s*in[\s\S]*google)|(google[\s\S]*sign\s*in)/i

/** store пуст при valid snapshot / грязный профиль (poster-runner.ts:269, 333-345). */
const BROWSER_STATE_RE =
  /Requesting main frame too early|store ПУСТОЙ|browser_disconnected|пуст(ой|ая)\s*store|Target\.createTarget:\s*Target closed/i

/** network / proxy latency / goto timeout (error-classifier.ts:114-122 + youtube-poster navigate). */
const NETWORK_RE =
  /ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|timeout|timed out|navigation timeout|network|socket hang up|ERR_INSUFFICIENT_RESOURCES|proxy bandwidth/i

/** DOM не найден всеми fallback-селекторами. */
const SELECTOR_RE = /Не найден|not found|selector/i

/** setInputFiles / processing / share URL fail. */
const UPLOAD_FAILED_RE = /залить видео|upload failed|не показал details|share URL|не вернул share|extract.?url/i

/** Явный login_required в message (poster-runner.ts:317-332). */
const LOGIN_REQUIRED_RE = /fresh login|нужен.*login|session.*(протух|expired)|не залогинен/i

/** restore reasons из cookies/snapshot-service, означающие реальное отсутствие cookies. */
const TERMINAL_RESTORE_REASONS = new Set(["no_snapshot", "all_expired", "decrypt_failed"])

// ---- input / output ----

export interface ClassifyPostingErrorInput {
  /** Текст ошибки (PostingPhaseError.message или Error.message). */
  message: string
  /** Текущая фаза FSM (влияет на selector vs network на open_upload_dialog). */
  phase?: YouTubePostingPhase
  /** Прогресс upload (для browser_lost → duplicate_risk guard). */
  progress?: YouTubePostingProgress
  /** login_check: restore reason attempt1/attempt2 (poster-runner). */
  restoreReason?: string
  /** login_check: store содержит хоть какие-то cookies. */
  storeHasCookies?: boolean
  /** login_check: snapshot реально содержал применимые cookies (applied+failed>0). */
  hadValidSnapshot?: boolean
  /** navigate: host после redirect (classifyStudioProbe). */
  redirectedHost?: string
}

export interface ClassifyPostingErrorResult {
  errorClass: YouTubePostingErrorClass
  disposition: "retryable" | "terminal" | "guarded"
  retryable: boolean
  terminal: boolean
  /** legacy enum для PostingJob.errorCategory (без новой миграции в PR1). */
  persistedCategory: PostingErrorCategory
  /** true — fingerprint сматчился уверенно; false — fallback (PR3 делегирует categorizeError). */
  confident: boolean
  /** Короткое пояснение, какой признак сработал. */
  reason: string
}

function progressIndex(p: YouTubePostingProgress | undefined): number {
  if (!p) return -1
  return YOUTUBE_POSTING_PROGRESS_ORDER.indexOf(p)
}

/** «Файл уже прикреплён» = прогресс ≥ file_attached_unconfirmed. */
function isAfterAttach(progress: YouTubePostingProgress | undefined): boolean {
  return progressIndex(progress) >= YOUTUBE_POSTING_PROGRESS_ORDER.indexOf("file_attached_unconfirmed")
}

function enrich(
  errorClass: YouTubePostingErrorClass,
  reason: string,
  confident: boolean,
): ClassifyPostingErrorResult {
  const policy = getClassRetryPolicy(errorClass)
  return {
    errorClass,
    disposition: policy.disposition,
    retryable: policy.disposition === "retryable",
    terminal: policy.disposition === "terminal",
    persistedCategory: policy.persistedCategory,
    confident,
    reason,
  }
}

/**
 * Классифицировать ошибку фазы FSM. Порядок проверок зеркалит арбитраж в
 * worker.ts (dead-port раньше browser_lost) + login_check ветки poster-runner.
 */
export function classifyPostingError(input: ClassifyPostingErrorInput): ClassifyPostingErrorResult {
  const msg = input.message ?? ""

  // 1. captcha / verify / phone — авто-постинг невозможен (terminal).
  if (REQUIRES_HUMAN_RE.test(msg)) {
    return enrich("requires_human", "captcha/verify/phone challenge fingerprint", true)
  }

  // 2. dead-port — РАНЬШЕ browser_lost (worker.ts:535 !isDeadPortIndigo).
  if (DEAD_PORT_RE.test(msg)) {
    return enrich("indigo_unstable", "dead-port: DevTools/CDP не открылся", true)
  }

  // 3. browser/page умер. После attach → duplicate_risk guard (§3/§4).
  if (BROWSER_LOST_RE.test(msg)) {
    if (isAfterAttach(input.progress)) {
      return enrich(
        "duplicate_risk",
        `browser_lost после attach (progress=${input.progress}) — нужен dedup guard`,
        true,
      )
    }
    return enrich("browser_lost", "detached Frame/Target closed до attach", true)
  }

  // 4. auth_required — redirect на Google Sign-In после navigate.
  const host = (input.redirectedHost ?? "").toLowerCase()
  const isSignInHost = host === "accounts.google.com" || host.endsWith(".accounts.google.com")
  if (isSignInHost || AUTH_REQUIRED_RE.test(msg)) {
    return enrich("auth_required", "redirect на accounts.google.com / Google Sign-In", true)
  }

  // 5. login_check context (poster-runner.ts:303-352).
  if (input.restoreReason && TERMINAL_RESTORE_REASONS.has(input.restoreReason)) {
    return enrich("login_required", `restore reason ${input.restoreReason} — нет применимых cookies`, true)
  }
  if (input.storeHasCookies === true && input.phase === "login_check") {
    // store есть, но classify дошёл сюда без auth-cookie → session протух.
    return enrich("login_required", "store содержит cookies, но без auth — session протух", true)
  }
  if (input.hadValidSnapshot === true && input.storeHasCookies === false) {
    // snapshot валиден, но store пуст — браузер отвалился во время restore (transient).
    return enrich("browser_state_error", "valid snapshot + store пуст — browser отвалился при restore", true)
  }

  // 6. browser_state по message (грязный профиль / main-frame-too-early).
  if (BROWSER_STATE_RE.test(msg)) {
    return enrich("browser_state_error", "browser store/target fingerprint", true)
  }

  // 7. явный login_required в тексте.
  if (LOGIN_REQUIRED_RE.test(msg)) {
    return enrich("login_required", "fresh login / session expired в message", true)
  }

  // 8. selector_not_found — но НЕ на open_upload_dialog (там намеренно network_error).
  if (SELECTOR_RE.test(msg) && input.phase !== "open_upload_dialog") {
    return enrich("selector_not_found", "DOM-селектор не найден", true)
  }

  // 9. upload_failed.
  if (UPLOAD_FAILED_RE.test(msg)) {
    return enrich("upload_failed", "upload/processing/share-url fingerprint", true)
  }

  // 10. network / proxy latency / goto timeout.
  if (NETWORK_RE.test(msg)) {
    return enrich("network_error", "network/timeout/proxy fingerprint", true)
  }

  // 11. fallback: ничего не сматчилось. confident=false — PR3 делегирует
  //     legacy categorizeError (которая вернёт unknown → terminal). Класс
  //     network_error выбран как наименее вредный плейсхолдер до делегирования.
  return enrich("network_error", "unclassified — fallback (PR3: делегировать categorizeError)", false)
}

/**
 * Legacy-маппинг логического класса FSM в persisted PostingErrorCategory.
 * Дублирует поле persistedCategory в CLASS_RETRY_POLICY — отдельная функция для
 * удобства PR3 (запись в PostingJob.errorCategory без новой миграции enum).
 */
export function mapErrorClassToPersisted(errorClass: YouTubePostingErrorClass): PostingErrorCategory {
  return getClassRetryPolicy(errorClass).persistedCategory
}
