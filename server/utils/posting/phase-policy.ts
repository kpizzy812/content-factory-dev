/**
 * Декларативная политика phase-level FSM для YouTube browser-automation постинга.
 *
 * ЧИСТЫЕ ДАННЫЕ + pure helpers — без БД, без side-effects, без зависимостей от
 * Nuxt/Prisma runtime. Формализует то, что сейчас размазано по:
 *   - youtube-poster.ts   (линейная цепочка фаз + per-step timeouts)
 *   - poster-runner.ts    (login_check классификация, dispatch)
 *   - worker.ts:handleFailure (regex + подсчёт маркеров в логах)
 *
 * Две таблицы:
 *   1. PHASE_POLICIES   — что за фаза, чем успешна, какие классы ошибок на ней
 *                         retryable/terminal, recovery, diagnostics.
 *   2. CLASS_RETRY_POLICY — как retry'ить класс ошибки (disposition, maxAttempts,
 *                           backoff, rolling-window, legacy persistedCategory).
 *                           Class-driven — зеркалит текущий worker.ts (retry
 *                           решается по классу+fingerprint, не по фазе).
 *
 * ВАЖНО: PR1 — фундамент. Эта таблица НИГДЕ не подключена к runtime. Числа
 * (maxAttempts/backoff/window) перенесены числом-в-число из текущего кода, чтобы
 * PR3 включил policy-driven retry без изменения поведения.
 *
 * @see docs/architecture/youtube-posting-fsm.md
 */

import type { PostingErrorCategory } from "../../../shared/types/posting-job"
import {
  YOUTUBE_POSTING_PHASE_ORDER,
  type ProgressRetryAction,
  type YouTubePostingErrorClass,
  type YouTubePostingPhase,
  type YouTubePostingProgress,
} from "../../../shared/types/youtube-posting-fsm"

// ---- backoff-константы (числом-в-число из state-machine.ts / worker.ts) ----

const MIN = 60 * 1000
const HOUR = 60 * MIN

/** Generic retryable backoff (state-machine.ts:RETRY_BACKOFF_MS), индекс = attemptCount-1. */
const GENERIC_BACKOFF_MS = [1 * MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 12 * HOUR]

/**
 * indigo_unstable (dead-port) backoff (worker.ts:454): priorRetries 0→5м, 1-2→10м,
 * ≥3→15м. Массив индексируется priorRetries с clamp-to-last (index3=15м покрывает всё дальше).
 */
const INDIGO_UNSTABLE_BACKOFF_MS = [5 * MIN, 10 * MIN, 10 * MIN, 15 * MIN]

/**
 * browser_lost backoff (worker.ts:565): priorRetries 0→5м, 1-2→7м, ≥3→10м.
 * Clamp-to-last (index3=10м).
 */
const BROWSER_LOST_BACKOFF_MS = [5 * MIN, 7 * MIN, 7 * MIN, 10 * MIN]

/** Окно good-window для *_unstable / browser_lost (worker.ts: RETRY_WINDOW_MS). */
const RETRY_WINDOW_MS = 90 * MIN

/** maxAttempts для оконных классов (worker.ts: MAX_INDIGO_RETRIES / MAX_BROWSER_LOST_RETRIES). */
const MAX_INDIGO_UNSTABLE = 7
const MAX_BROWSER_LOST = 5

// ---- per-class retry policy ----

/** Как обрабатывать класс ошибки при провале фазы. */
export interface ClassRetryPolicy {
  errorClass: YouTubePostingErrorClass
  /**
   * retryable — авто-retry (по maxAttempts/window);
   * terminal — сразу в failed;
   * guarded — решение зависит от progress (duplicate-upload guard, см. getProgressRetryPolicy).
   */
  disposition: "retryable" | "terminal" | "guarded"
  /** Лимит попыток. null = использовать PostingJob.maxAttempts (generic-классы). */
  maxAttempts: number | null
  /** Backoff по priorRetries (clamp-to-last). Пусто для terminal. */
  backoffMs: number[]
  /** Rolling-window (ms) для оконных классов; null — окна нет. */
  windowMs: number | null
  /**
   * Режим окна (PR3, точное воспроизведение legacy worker.ts):
   *   - "deadline" (indigo_unstable): окно фиксировано от первой ошибки; terminal
   *     если count≥max ИЛИ elapsed≥window (legacy: priorRetries<7 && windowRemaining>0).
   *   - "rolling" (browser_lost): окно сбрасывается по истечении; terminal только
   *     если count≥max (legacy: rolling 90-мин окно по маркерам).
   * undefined — окна нет (generic/terminal).
   */
  windowMode?: "deadline" | "rolling"
  /** Во что писать persisted PostingJob.errorCategory (legacy enum, без новой миграции в PR1). */
  persistedCategory: PostingErrorCategory
  /** Человеческое пояснение/recovery. */
  note: string
}

export const CLASS_RETRY_POLICY: Record<YouTubePostingErrorClass, ClassRetryPolicy> = {
  browser_connect_failed: {
    errorClass: "browser_connect_failed",
    disposition: "terminal",
    maxAttempts: 0,
    backoffMs: [],
    windowMs: null,
    persistedCategory: "browser_connect_failed",
    note: "puppeteer.connect упал стабильно / automation off в Indigo. Оператор чинит профиль. (dead-port fingerprint → indigo_unstable, отдельный класс).",
  },
  browser_state_error: {
    errorClass: "browser_state_error",
    disposition: "retryable",
    maxAttempts: null, // PostingJob.maxAttempts
    backoffMs: GENERIC_BACKOFF_MS,
    windowMs: null,
    persistedCategory: "network_error",
    note: "store пуст при valid snapshot / грязный профиль (targets>15, newPage Target closed). Transient — новая сессия проживёт дольше.",
  },
  network_error: {
    errorClass: "network_error",
    disposition: "retryable",
    maxAttempts: null,
    backoffMs: GENERIC_BACKOFF_MS,
    windowMs: null,
    persistedCategory: "network_error",
    note: "proxy latency / goto timeout / ECONN*. Generic retry по PostingJob.maxAttempts.",
  },
  auth_required: {
    errorClass: "auth_required",
    disposition: "terminal",
    maxAttempts: 0,
    backoffMs: [],
    windowMs: null,
    persistedCategory: "login_required",
    note: "redirect на accounts.google.com после navigate — session протухла. Нужен ручной re-login в Indigo X desktop.",
  },
  login_required: {
    errorClass: "login_required",
    disposition: "terminal",
    maxAttempts: 0,
    backoffMs: [],
    windowMs: null,
    persistedCategory: "login_required",
    note: "snapshot нет/полностью протух / store без auth-cookies. Нужен fresh login + cookie refresh.",
  },
  selector_not_found: {
    errorClass: "selector_not_found",
    disposition: "terminal",
    maxAttempts: 0,
    backoffMs: [],
    windowMs: null,
    persistedCategory: "selector_not_found",
    note: "DOM не найден всеми fallback-селекторами — YouTube сменил вёрстку, нужно обновить poster. (openUploadDialog намеренно кидает network_error для retry).",
  },
  upload_failed: {
    errorClass: "upload_failed",
    disposition: "retryable",
    maxAttempts: null, // PostingJob.maxAttempts; на практике ~1 доп. попытка
    backoffMs: GENERIC_BACKOFF_MS,
    windowMs: null,
    persistedCategory: "upload_failed",
    note: "setInputFiles / processing timeout / URL не пришёл. Transient на стороне платформы.",
  },
  browser_lost: {
    errorClass: "browser_lost",
    disposition: "retryable",
    maxAttempts: MAX_BROWSER_LOST,
    backoffMs: BROWSER_LOST_BACKOFF_MS,
    windowMs: RETRY_WINDOW_MS,
    windowMode: "rolling",
    persistedCategory: "network_error",
    note: "detached Frame / Target closed / Session closed / Execution context destroyed. Indigo потерял page — cooldown ловит good-window. ВНИМАНИЕ: после file attach → duplicate_risk guard.",
  },
  indigo_unstable: {
    errorClass: "indigo_unstable",
    disposition: "retryable",
    maxAttempts: MAX_INDIGO_UNSTABLE,
    backoffMs: INDIGO_UNSTABLE_BACKOFF_MS,
    windowMs: RETRY_WINDOW_MS,
    windowMode: "deadline",
    persistedCategory: "browser_connect_failed",
    note: "dead-port: Indigo отдал port, но CDP не открылся (DevTools not ready). Backoff ловит стабильное окно. Исчерпание окна → requires_human.",
  },
  duplicate_risk: {
    errorClass: "duplicate_risk",
    disposition: "guarded",
    maxAttempts: MAX_BROWSER_LOST,
    backoffMs: BROWSER_LOST_BACKOFF_MS,
    windowMs: RETRY_WINDOW_MS,
    windowMode: "rolling",
    persistedCategory: "network_error",
    note: "браузер умер после attach/publish — слепой re-upload даст дубль. Решение по getProgressRetryPolicy: dedup_check или verify_no_republish.",
  },
  requires_human: {
    errorClass: "requires_human",
    disposition: "terminal",
    maxAttempts: 0,
    backoffMs: [],
    windowMs: null,
    persistedCategory: "account_locked",
    note: "captcha / verify it's you / phone challenge / 2FA, либо исчерпаны окна всех transient-классов. Авто-постинг невозможен.",
  },
}

// ---- per-phase policy ----

export interface PhasePolicy {
  phase: YouTubePostingPhase
  purpose: string
  /** Критерий успешного прохождения фазы. */
  successCriteria: string
  /** Классы ошибок, которые на этой фазе считаются retryable/guarded. */
  retryableClasses: YouTubePostingErrorClass[]
  /** Классы ошибок, которые на этой фазе terminal. */
  terminalClasses: YouTubePostingErrorClass[]
  /** Что делает recovery (описательно — реализация в PR2+). */
  recoveryAction: string
  /** Имена checkpoint/trace для диагностики (zavodcamp/posting-errors/...). */
  diagnostics: string[]
}

export const PHASE_POLICIES: Record<YouTubePostingPhase, PhasePolicy> = {
  session_start: {
    phase: "session_start",
    purpose: "Старт Indigo profile, получить рабочий CDP-порт",
    successCriteria: "startBrowserSession вернул валидный port",
    retryableClasses: ["indigo_unstable"],
    // requires_human = исчерпание good-window indigo_unstable (worker.ts:494-521).
    // proxy_dead (assertProxyHealthyBeforeSession 503) тоже terminal на этой фазе,
    // но это pre-existing категория вне 11-классового вокабуляра FSM — путь не трогаем.
    terminalClasses: ["requires_human"],
    recoveryAction: "Авто-retry на good-window (backoff 5/10/15м, до 7× за 90м). Перед manual retry — поднять профиль через /indigo/[id]. proxy_dead → terminal (existing path).",
    diagnostics: ["session_start/start", "port", "internalAttempts"],
  },
  connect_browser: {
    phase: "connect_browser",
    purpose: "puppeteer.connect к CDP-порту (direct newPage, не pages())",
    successCriteria: "получен Browser + page",
    retryableClasses: ["browser_connect_failed", "browser_state_error"],
    terminalClasses: [],
    recoveryAction: "Новая сессия. Стабильный ECONNREFUSED (automation off) → terminal, чинит оператор.",
    diagnostics: ["cdp_connect/connect", "cdp_connect/newPage"],
  },
  restore_cookies: {
    phase: "restore_cookies",
    purpose: "Инжект cookies из БД-snapshot перед navigation",
    successCriteria: "restore завершён (fail-soft, applied≥0)",
    retryableClasses: [],
    terminalClasses: [],
    recoveryAction: "Фаза fail-soft, не падает. Пустой store обрабатывается в login_check.",
    diagnostics: ["login_check/restore_a{n}_f{n}"],
  },
  browser_leak_check: {
    phase: "browser_leak_check",
    purpose: "Проверить, что Chromium ходит через proxy, а не реальный IP сервера",
    successCriteria: "IP в браузере ≠ серверный (нет утечки)",
    retryableClasses: [],
    // Утечка → persisted proxy_dead (pre-existing terminal путь, PostingPhaseError),
    // вне 11-классового вокабуляра FSM — намеренно не дублируем как FSM-класс.
    terminalClasses: [],
    recoveryAction: "Утечка = пост ОТМЕНЁН (proxy_dead, terminal, existing path). Оператор чинит Indigo profile / proxy. Авто-retry НЕТ (публикация = гарантированный бан).",
    diagnostics: ["browser_leak_check/leak", "detectedIp"],
  },
  login_check: {
    phase: "login_check",
    purpose: "Дождаться auth-cookies (SAPISID/__Secure-3PAPISID) в store",
    successCriteria: "≥1 auth-cookie появился (waitForCloudCookies ready)",
    retryableClasses: ["browser_state_error", "network_error"],
    terminalClasses: ["login_required"],
    recoveryAction: "valid snapshot + store пуст → retry новая сессия (browser_state_error). no_snapshot/all_expired/store-без-auth → terminal login_required.",
    diagnostics: ["login_check/restore_store_empty", "login_check/timeout_..._cookies_{n}", "authProbe"],
  },
  navigate_upload: {
    phase: "navigate_upload",
    purpose: "Открыть studio.youtube.com (goto + soft-probe)",
    successCriteria: "classifyStudioProbe === 'studio'",
    retryableClasses: ["network_error", "browser_lost"],
    terminalClasses: ["auth_required"],
    recoveryAction: "goto timeout → soft-probe (DOM мог быть готов) + retry через about:blank. Redirect на accounts.google.com → terminal auth_required.",
    diagnostics: ["navigate_upload/navigate_to_studio_preemptive_90000ms", "navigate_upload/goto_timeout_probe", "navigate_upload/studio_loaded_ok"],
  },
  open_upload_dialog: {
    phase: "open_upload_dialog",
    purpose: "Открыть upload dialog (channelId → direct URL ?d=ud → Create-click)",
    successCriteria: "file input доступен",
    retryableClasses: ["network_error", "browser_lost"],
    terminalClasses: [],
    recoveryAction: "evalRace 8s на каждый eval (не висим 120s), last-resort goto ?d=ud. selector miss → network_error (retryable, не selector_not_found).",
    diagnostics: ["navigate_upload/open_upload_dialog_preemptive_120000ms", "navigate_upload/channel_*", "navigate_upload/before_deep_click_create"],
  },
  file_upload: {
    phase: "file_upload",
    purpose: "Прикрепить видео (inputHandle.uploadFile)",
    successCriteria: "upload принят YouTube",
    retryableClasses: ["upload_failed", "browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "browser_lost после attach → duplicate_risk guard (dedup_check перед re-upload). file input не найден за 120s → terminal selector_not_found.",
    diagnostics: ["file_upload/error", "progress"],
  },
  upload_processing: {
    phase: "upload_processing",
    purpose: "Дождаться details-формы (≤15 мин)",
    successCriteria: "details-форма видна (UPLOAD_PROCESSING_DONE_SELECTORS)",
    retryableClasses: ["upload_failed", "browser_lost", "duplicate_risk"],
    terminalClasses: [],
    recoveryAction: "retry с dedup-check (файл уже грузится — проверить draft перед re-upload).",
    diagnostics: ["file_upload/error"],
  },
  fill_details: {
    phase: "fill_details",
    purpose: "Ввести title + description (+ altered content disclosure)",
    successCriteria: "поля заполнены",
    retryableClasses: ["browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "retry с dedup-check. title/description input не найден → terminal selector_not_found.",
    diagnostics: ["details/error"],
  },
  set_audience: {
    phase: "set_audience",
    purpose: "Выбрать Made-for-kids (обязательный radio)",
    successCriteria: "radio выбран",
    retryableClasses: ["browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "retry с dedup-check. MFK radio не найден → terminal (publish будет заблокирован YouTube).",
    diagnostics: ["made_for_kids/error"],
  },
  set_visibility: {
    phase: "set_visibility",
    purpose: "Перейти к visibility (Next×3) + выбрать Public/Unlisted/Private",
    successCriteria: "visibility radio выбран",
    retryableClasses: ["browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "retry с dedup-check. visibility radio не найден → terminal selector_not_found.",
    diagnostics: ["visibility/error"],
  },
  publish: {
    phase: "publish",
    purpose: "Клик Publish",
    successCriteria: "Publish кликнут",
    retryableClasses: ["browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "до клика — retry с dedup. ПОСЛЕ клика (publish_clicked) — verify_no_republish: проверить опубликовано ли, не кликать повторно.",
    diagnostics: ["submit/error"],
  },
  verify_published: {
    phase: "verify_published",
    purpose: "Получить platformPostUrl / platformPostId",
    successCriteria: "URL вида /watch?v= или /shorts/ получен",
    retryableClasses: ["upload_failed"],
    terminalClasses: [],
    recoveryAction: "URL не пришёл за 120s → проверить канал (видео могло опубликоваться). Найдено → published; иначе requires_human.",
    diagnostics: ["extract_url/error"],
  },
  save_snapshot: {
    phase: "save_snapshot",
    purpose: "Сохранить cookies в БД-snapshot (всегда, в т.ч. при провале)",
    successCriteria: "saved=true (best-effort, 5s timeout)",
    retryableClasses: [],
    terminalClasses: [],
    recoveryAction: "Best-effort, не падает. Indigo чистит cloud-state на /stop — без save следующий retry потребует ручного login.",
    diagnostics: ["cookie save (finally)"],
  },
  cleanup: {
    phase: "cleanup",
    purpose: "Закрыть session + stopIndigoSession + удалить tmp",
    successCriteria: "ресурсы освобождены",
    retryableClasses: [],
    terminalClasses: [],
    recoveryAction: "Всё идемпотентно (session.close / stopIndigoSession / fetched.cleanup). Гарантирован finally.",
    diagnostics: [],
  },
  // --- Instagram Reel desktop-флоу (PR1: placeholder-политики, чтобы Record был
  // exhaustive над расширенным union'ом). НЕ подключены к runtime (как и вся
  // таблица). Реальные retry/recovery-решения для IG — PR3 (runInstagramReelPhases),
  // там же policy будет уточнена под реальные классы ошибок IG. listPhasePolicies
  // итерирует только YOUTUBE_POSTING_PHASE_ORDER → ig_* не влияют на YouTube.
  ig_open_create: {
    phase: "ig_open_create",
    purpose: "Открыть диалог создания поста (клик Create/+)",
    successCriteria: "[role=dialog] появился",
    retryableClasses: ["network_error", "browser_lost"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "PR3: уточнить под реальный IG-флоу.",
    diagnostics: ["ig_open_create/error"],
  },
  ig_select_file: {
    phase: "ig_select_file",
    purpose: "Select from computer → acceptFileChooser → дождаться crop-опций",
    successCriteria: "crop-опции (Original/9:16) видны",
    retryableClasses: ["upload_failed", "browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "PR3: уточнить под реальный IG-флоу (нет draftVideoId — консервативный resume).",
    diagnostics: ["ig_select_file/error"],
  },
  ig_crop_next: {
    phase: "ig_crop_next",
    purpose: "(опц. crop) → Next #1 → Edit-экран",
    successCriteria: "Edit-экран виден",
    retryableClasses: ["browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "PR3: уточнить под реальный IG-флоу.",
    diagnostics: ["ig_crop_next/error"],
  },
  ig_edit_next: {
    phase: "ig_edit_next",
    purpose: "Next #2 → caption-поле",
    successCriteria: "caption-поле видно",
    retryableClasses: ["browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "PR3: уточнить под реальный IG-флоу.",
    diagnostics: ["ig_edit_next/error"],
  },
  ig_caption: {
    phase: "ig_caption",
    purpose: "Ввести caption + hashtags (type() посимвольно)",
    successCriteria: "caption введён",
    retryableClasses: ["browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "PR3: уточнить под реальный IG-флоу.",
    diagnostics: ["ig_caption/error"],
  },
  ig_share: {
    phase: "ig_share",
    purpose: "Клик Share",
    successCriteria: "Share кликнут (publish_clicked)",
    retryableClasses: ["browser_lost", "duplicate_risk"],
    terminalClasses: ["selector_not_found"],
    recoveryAction: "PR3: после клика — verify_no_republish (нет draftVideoId, дедуп по shortcode).",
    diagnostics: ["ig_share/error"],
  },
  ig_verify: {
    phase: "ig_verify",
    purpose: "Перехват media.code (shortcode) / профиль-верификация",
    successCriteria: "shortcode захвачен (publish_confirmed)",
    retryableClasses: ["upload_failed"],
    terminalClasses: [],
    recoveryAction: "PR3: shortcode не пришёл → профиль-верификация; неуверенность → block (requires_human).",
    diagnostics: ["ig_verify/error"],
  },
}

// ---- pure helpers ----

/** Политика всех фаз (стабильный порядок выполнения). */
export function listPhasePolicies(): PhasePolicy[] {
  return YOUTUBE_POSTING_PHASE_ORDER.map((p) => PHASE_POLICIES[p])
}

export function getPhasePolicy(phase: YouTubePostingPhase): PhasePolicy {
  return PHASE_POLICIES[phase]
}

export function getClassRetryPolicy(errorClass: YouTubePostingErrorClass): ClassRetryPolicy {
  return CLASS_RETRY_POLICY[errorClass]
}

/**
 * Backoff по номеру уже сделанной попытки (clamp-to-last) — pure расчёт без Date.
 * priorRetries=0 → backoffMs[0]. Возвращает 0 если backoff пуст (terminal).
 */
export function backoffForRetry(errorClass: YouTubePostingErrorClass, priorRetries: number): number {
  const arr = CLASS_RETRY_POLICY[errorClass].backoffMs
  if (arr.length === 0) return 0
  const idx = Math.min(Math.max(priorRetries, 0), arr.length - 1)
  return arr[idx]!
}

/**
 * Duplicate-upload guard: какое действие при retry для данного прогресса.
 *   file_not_attached                     → retry_safe (грузить заново можно)
 *   file_attached_unconfirmed/upload_started/processing_seen/details_seen → dedup_check
 *   publish_clicked/publish_confirmed     → verify_no_republish (риск дубля)
 */
export function getProgressRetryPolicy(progress: YouTubePostingProgress): ProgressRetryAction {
  switch (progress) {
    case "file_not_attached":
      return "retry_safe"
    case "file_attached_unconfirmed":
    case "upload_started":
    case "processing_seen":
    case "details_seen":
      return "dedup_check"
    case "publish_clicked":
    case "publish_confirmed":
      return "verify_no_republish"
  }
}
