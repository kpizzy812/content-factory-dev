/**
 * Phase-level FSM для YouTube browser-automation постинга (Indigo CDP + puppeteer).
 *
 * Это data-слой (типы + перечисления), который шарится сервером и клиентом.
 * Чистая декларация — НЕ содержит логики и side-effects.
 *
 * Контекст: поверх job-level FSM (PostingJobStatus: scheduled→…→published) живёт
 * phase-level конвейер из 16 шагов, который выполняется пока job в статусе
 * `uploading`. Раньше эти шаги были неявной линейной цепочкой await'ов в
 * youtube-poster.ts + poster-runner.ts, а resilience — императивными ветками с
 * regex по message в worker.ts:handleFailure. Этот модуль формализует фазы и
 * persisted-состояние FSM.
 *
 * ВАЖНО: на момент PR1 эти типы НЕ подключены к runtime — фундамент без
 * изменения поведения прода. Проигрывается через PhaseRunner в PR2+ под флагом
 * YOUTUBE_POSTING_FSM_ENABLED (default OFF).
 *
 * @see docs/architecture/youtube-posting-fsm.md
 */

/**
 * 16 фаз phase-level FSM. Реконсиляция исходного 15-шагового пайплайна с
 * реальными функциями youtube-poster.ts + обязательным safety-шагом
 * browser_leak_check (проверка, что Chromium ходит через proxy, не реальный IP).
 *
 * Отличается от server/automation/posters/types.ts:PostingPhase (13 значений,
 * метки текущих throw'ов) — это целевая каноническая модель FSM.
 */
export type YouTubePostingPhase =
  | "session_start" //       startIndigoSessionForCdp → CDP-порт
  | "connect_browser" //     puppeteer.connect (direct newPage, не pages())
  | "restore_cookies" //     restoreCookiesFromSnapshot (fail-soft)
  | "browser_leak_check" //  assertNoLeakInBrowser — proxy leak = terminal
  | "login_check" //         waitForCloudCookies + retry restore ×2
  | "navigate_upload" //     navigateToStudio (goto + soft-probe)
  | "open_upload_dialog" //  openUploadDialog (channelId → direct URL → Create)
  | "file_upload" //         uploadVideoFile → inputHandle.uploadFile
  | "upload_processing" //   ожидание details-формы (≤15 мин)
  | "fill_details" //        fillDetails (title/description) + altered content
  | "set_audience" //        setMadeForKids (обязательный radio)
  | "set_visibility" //      advanceToVisibilityStep + setVisibility
  | "publish" //             submitPublish
  | "verify_published" //    extractPostUrl + extractVideoId
  | "save_snapshot" //       saveCookiesSnapshot (best-effort, всегда)
  | "cleanup" //             session.close + stopIndigoSession + tmp cleanup
  // --- Instagram Reel desktop-флоу (аддитивно, PR1; реализация в PR2+).
  // Эти фазы живут в общем union, чтобы IG-poster переиспользовал тот же
  // observer/retry/recovery-каркас без форка типов (см. instagram_posting_plan.md).
  | "ig_open_create" //      клик Create(+) → [role="dialog"] появился
  | "ig_select_file" //      Select from computer → acceptFileChooser → crop-опции
  | "ig_crop_next" //        (опц. crop) → Next #1 → Edit-экран
  | "ig_edit_next" //        Next #2 → caption-поле
  | "ig_caption" //          ввод caption + hashtags (type() посимвольно)
  | "ig_share" //            клик Share → markPublishClicked
  | "ig_verify" //           перехват media.code (shortcode) / профиль-верификация

/** Порядок выполнения фаз — единственный источник истины для PhaseRunner (PR2+). */
export const YOUTUBE_POSTING_PHASE_ORDER: readonly YouTubePostingPhase[] = [
  "session_start",
  "connect_browser",
  "restore_cookies",
  "browser_leak_check",
  "login_check",
  "navigate_upload",
  "open_upload_dialog",
  "file_upload",
  "upload_processing",
  "fill_details",
  "set_audience",
  "set_visibility",
  "publish",
  "verify_published",
  "save_snapshot",
  "cleanup",
] as const

/**
 * Прогресс upload-pipeline — substatus для idempotency / duplicate-upload guard.
 * Монотонно возрастает. persisted в stateData.progress, переживает рестарт Nitro.
 * Используется на retry чтобы решить: безопасно ли грузить заново (см. §4 спеки).
 */
export type YouTubePostingProgress =
  | "file_not_attached" //          файл ещё не прикреплён — retry безопасен
  | "file_attached_unconfirmed" //  attach без подтверждения
  | "upload_started" //             файл точно пошёл на YouTube
  | "processing_seen" //            YouTube показал processing/details
  | "details_seen" //               details-форма видна (draft существует на Studio)
  | "publish_clicked" //            Publish кликнут, URL ещё не подтверждён
  | "publish_confirmed" //          terminal success — URL/ID получены

/** Порядок прогресса (индекс = «глубина»). Для сравнения «дошли ли мы дальше X». */
export const YOUTUBE_POSTING_PROGRESS_ORDER: readonly YouTubePostingProgress[] = [
  "file_not_attached",
  "file_attached_unconfirmed",
  "upload_started",
  "processing_seen",
  "details_seen",
  "publish_clicked",
  "publish_confirmed",
] as const

/**
 * Логический вокабуляр ошибок FSM (11 классов) — надмножество persisted
 * PostingErrorCategory (shared/types/posting-job.ts). 5 классов уже есть в
 * prisma enum, 6 (browser_state_error, auth_required, browser_lost,
 * indigo_unstable, duplicate_risk, requires_human) на момент PR1 НЕ заводятся
 * в enum (минимальная аддитивная миграция) — хранятся в stateData, а в
 * persisted errorCategory пишется legacy-маппинг (см. mapErrorClassToPersisted
 * в error-taxonomy.ts). Promotion в enum-значения — отдельный поздний PR.
 */
export type YouTubePostingErrorClass =
  | "browser_connect_failed" //  puppeteer.connect упал / automation off
  | "browser_state_error" //     store пуст при valid snapshot; грязный профиль
  | "network_error" //           proxy latency, goto timeout, ECONN*
  | "auth_required" //           redirect на accounts.google.com ПОСЛЕ navigate
  | "login_required" //          snapshot нет/протух / store без auth-cookies
  | "selector_not_found" //      DOM не найден всеми fallback-селекторами
  | "upload_failed" //           setInputFiles / processing timeout / нет URL
  | "browser_lost" //            detached Frame / Target closed внутри pipeline
  | "indigo_unstable" //         dead-port / окно good-window исчерпано
  | "duplicate_risk" //          браузер умер после attach/publish — риск дубля
  | "requires_human" //          captcha / verify / phone challenge / exhaustion

/** Все классы для итерации в тестах/policy. */
export const YOUTUBE_POSTING_ERROR_CLASSES: readonly YouTubePostingErrorClass[] = [
  "browser_connect_failed",
  "browser_state_error",
  "network_error",
  "auth_required",
  "login_required",
  "selector_not_found",
  "upload_failed",
  "browser_lost",
  "indigo_unstable",
  "duplicate_risk",
  "requires_human",
] as const

/**
 * Состояние «окна» retry для класса ошибки. Заменяет подсчёт маркеров через
 * `PostingJobLog.message contains MARKER` (worker.ts:436-447) — атомарно,
 * переживает рестарт, не зависит от текста логов.
 */
export interface ClassWindowState {
  /** Сколько retry этого класса уже сделано в текущем окне. */
  count: number
  /** ISO-таймстамп старта окна (для расчёта elapsed / rolling-window). */
  windowStartAt: string
  /** ISO-таймстамп отправленного Telegram-алерта (dedup, чтобы не спамить). null — ещё не слали. */
  alertedAt: string | null
  /** ISO-таймстамп последней ошибки этого класса (PR3). */
  lastErrorAt?: string
  /** Фаза последней ошибки этого класса (PR3). */
  lastPhase?: string | null
  /** Усечённое сообщение последней ошибки (PR3, для диагностики). */
  lastMessage?: string
}

/** Текущая версия формата stateData. Бамп при несовместимом изменении формы. */
export const YOUTUBE_POSTING_FSM_VERSION = 1

/**
 * Persisted runtime-состояние phase-level FSM. Хранится в PostingJob.stateData
 * (Json?, nullable). null/отсутствие fsmVersion = job НЕ управляется FSM
 * (legacy-путь) — критично для backward-compat в worker.ts.
 */
export interface YouTubePostingStateData {
  /** Версия формата (см. YOUTUBE_POSTING_FSM_VERSION). */
  fsmVersion: number
  /** RUNNER_BUILD_MARKER на момент запуска — доказывает версию кода. */
  buildMarker: string
  /** Текущая (или последняя) фаза. */
  currentPhase: YouTubePostingPhase
  /** Прогресс upload-pipeline — ключ для duplicate-upload guard. */
  progress: YouTubePostingProgress
  /** ID черновика на YouTube, как только Studio его присвоил — сильнейший dedup-ключ. null до захвата. */
  draftVideoId: string | null
  /**
   * Instagram: shortcode опубликованного поста (из media.code, появляется только
   * ПОСЛЕ Share). IG-аналог draftVideoId — единственный надёжный dedup-ключ для
   * resume без черновика (PR1 ADD-only; пишется IG-poster'ом в PR3). null до захвата.
   */
  platformPostShortcode?: string | null
  /** Instagram: канонический URL поста (https://www.instagram.com/reel/{shortcode}/), захваченный вместе с shortcode (PR1 ADD-only). */
  platformPostUrl?: string | null
  /** URL черновика (studio edit / canonical), захваченный вместе с draftVideoId (PR4). */
  draftUrl?: string | null
  /** Фингерпринт title загружаемого видео — слабый dedup-ключ для resume без draftVideoId (PR4). */
  uploadTitleFingerprint?: string | null
  /** basename загружаемого файла (диагностика resume, PR4). */
  uploadedFileName?: string | null
  /** ISO-таймстамп успешного attach файла (progress=file_attached_unconfirmed, PR4). */
  fileAttachedAt?: string | null
  /** ISO-таймстамп клика Publish (progress=publish_clicked — после этого никогда не republish, PR4). */
  publishClickedAt?: string | null
  /** Был ли уже израсходован единственный bounded re-upload при unconfirmed attach (PR4 guard). */
  duplicateRiskAcknowledged?: boolean
  /** Счётчик попыток на фазу (для per-phase max attempts). */
  phaseAttempts: Partial<Record<YouTubePostingPhase, number>>
  /** Rolling-window счётчики по классам transient-ошибок. */
  classWindows: Partial<Record<YouTubePostingErrorClass, ClassWindowState>>
  /** ISO-таймстамп последнего перехода (heartbeat для stuck-detection в worker). */
  lastTransitionAt: string
  /** Последняя успешно завершённая (exitPhase) фаза. Для чтения "где был успех" при провале. */
  lastCompletedPhase?: YouTubePostingPhase | null
  /** Классифицированный класс последней ошибки (PR2B failPhase). null/нет — провалов не было. */
  lastErrorClass?: YouTubePostingErrorClass | null
  /** Фаза, на которой произошёл последний провал (PR2B failPhase). */
  lastErrorPhase?: YouTubePostingPhase | null
  /** Причина окончательного провала (PR3 policy: "indigo_unstable" | "browser_lost" | класс). */
  finalReason?: string | null
}

/**
 * Наблюдатель фаз (observability-слой PR2A). Реализация — server/utils/posting/
 * fsm-observer.ts:createPhaseObserver. Интерфейс в shared, чтобы PostInput
 * (server/automation/posters/types.ts) ссылался на него без циклической
 * зависимости. Все методы best-effort: НИКОГДА не throws, при выключенном флаге
 * YOUTUBE_POSTING_FSM_ENABLED — no-op (enabled=false).
 */
export interface PhaseObserver {
  /** true только когда YOUTUBE_POSTING_FSM_ENABLED=true. */
  readonly enabled: boolean
  /** Вход в фазу: stateData.currentPhase + phaseAttempts++ + STATE_ENTER. */
  enterPhase(phase: YouTubePostingPhase): Promise<void>
  /** Успешный выход: stateData.lastCompletedPhase + STATE_EXIT. */
  exitPhase(phase: YouTubePostingPhase): Promise<void>
  /** Провал фазы: STATE_FAIL + currentPhase (НЕ влияет на retry — это делает worker). */
  failPhase(phase: YouTubePostingPhase, error: unknown): Promise<void>
  /** Обновить progress (duplicate-upload guard substatus). */
  updateProgress(progress: YouTubePostingProgress): Promise<void>
  /** PR4: attach файла принят — progress=file_attached_unconfirmed + fileAttachedAt (момент, после которого слепой re-upload рискует дублем). */
  markFileAttached(): Promise<void>
  /** PR4: захвачен draftVideoId (+ опц. draftUrl) — сильнейший dedup-ключ для resume. Лог DRAFT_ID_CAPTURED. */
  captureDraft(draftVideoId: string, draftUrl?: string): Promise<void>
  /**
   * PR1 (Instagram): захвачен shortcode опубликованного поста (+ url) — IG-аналог
   * captureDraft, единственный надёжный dedup-ключ для IG. Пишет
   * stateData.platformPostShortcode + platformPostUrl. Опциональный (YouTube не зовёт).
   */
  captureShortcode?(shortcode: string, url: string): Promise<void>
  /** PR4: Publish кликнут — progress=publish_clicked + publishClickedAt (после этого НИКОГДА не republish). */
  markPublishClicked(): Promise<void>
  /** PR4: единственный bounded re-upload при unconfirmed attach израсходован — duplicateRiskAcknowledged=true. */
  acknowledgeDuplicateRisk(): Promise<void>
  /** PR4: метаданные загрузки (фингерпринт title + имя файла) для диагностики resume. */
  setUploadMeta(uploadTitleFingerprint: string, uploadedFileName: string): Promise<void>
}

/**
 * Action при retry в зависимости от прогресса (duplicate-upload guard).
 * retry_safe — грузить заново можно; dedup_check — перед re-upload проверить
 * draft на Studio; verify_no_republish — НЕ кликать publish повторно, сначала
 * проверить опубликовано ли (риск дубля).
 */
export type ProgressRetryAction =
  | "retry_safe"
  | "dedup_check"
  | "verify_no_republish"

/**
 * План возобновления job после browser_lost/duplicate_risk (PR4). Результат
 * чистой resolveResumePlan(stateData) (server/utils/posting/resume-policy.ts) —
 * runner интерпретирует его и стартует steps НЕ обязательно с navigate.
 *
 *   fresh               — ничего не прикреплено (progress<file_attached_unconfirmed)
 *                         → обычный прогон с navigate_upload.
 *   resume_from_details — есть draftVideoId (сильнейший dedup-ключ) → открыть
 *                         draft edit URL и продолжить с fill_details, БЕЗ re-upload.
 *   verify_only         — Publish уже кликнут (progress>=publish_clicked) → ТОЛЬКО
 *                         проверить опубликовано ли, НИКОГДА не кликать Publish снова.
 *   reupload_once       — file_attached_unconfirmed без draftVideoId и единственный
 *                         bounded re-upload ещё не израсходован → разрешить один.
 *   duplicate_blocked   — небезопасно (upload пошёл/re-upload израсходован, draft не
 *                         найден) → блокировать, чтобы не создать дубль (duplicate_risk).
 */
export type ResumePlan =
  | "fresh"
  | "resume_from_details"
  | "verify_only"
  | "reupload_once"
  | "duplicate_blocked"
