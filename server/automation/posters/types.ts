/**
 * Общие типы для browser-automation постеров (TikTok / YouTube / Instagram).
 *
 * Phase tracking: каждый poster внутри себя проходит набор шагов из enum
 * PostingPhase. Если шаг падает, poster делает captureErrorScreenshot и
 * throws Error с phase в message — poster-runner парсит phase и сохраняет
 * в PostingJob.lastErrorPhase + lastErrorScreenshotKey.
 *
 * Контракт текстовых полей (важно для платформ):
 *   - caption: единое поле для платформ, где описание одно (TikTok, IG).
 *   - title + description: раздельные поля для YouTube. Источник — модель
 *     Caption (per-platform), которая хранит title/description раздельно.
 *   - hashtags: общий список (TikTok добавляет в конец caption, YouTube
 *     включает в description и помечает Shorts).
 *
 * Platform-namespace: для платформо-специфичных опций (YouTube visibility,
 * made-for-kids, shorts) используется поле `youtube` — это явный домен YouTube
 * и не путается с TikTok/IG. По мере роста других платформ добавятся `tiktok`,
 * `instagram` namespace по тому же принципу.
 */

import type { Platform } from "../../../app/generated/prisma/client"
import type {
  PhaseObserver,
  YouTubePostingStateData,
} from "../../../shared/types/youtube-posting-fsm"

/** Шаги внутри poster.run(). */
export type PostingPhase =
  | "session_start"        // startIndigoSessionForCdp
  | "cdp_connect"          // puppeteer.connect к CDP порту
  | "browser_leak_check"   // assertNoLeakInBrowser внутри CDP — критический safety шаг
  | "login_check"          // checkPlatformLoginStatus
  | "navigate_upload"      // page.goto на страницу загрузки
  | "file_upload"          // setInputFiles + дождаться processing
  | "caption"              // ввод caption + hashtags (TikTok/IG)
  | "details"              // ввод title + description + tags (YouTube)
  | "altered_content"      // YouTube: VIDEO_HAS_ALTERED_CONTENT_YES/NO (обязательно с 21.05.2025 для AI-generated)
  | "made_for_kids"        // выбор Made-for-kids (YouTube — обязательно)
  | "visibility"           // выбор Public/Unlisted/Private (YouTube)
  | "submit"               // клик publish
  | "extract_url"          // распарсить platformPostUrl из page.url()
  // --- Instagram Reel desktop-флоу (PR1 аддитивно; реализация PR2+).
  // Те же метки, что в YouTubePostingPhase ig_* — иначе PostingPhaseError.phase
  // из IG-poster'а не пройдёт по типу и mapPostingPhaseToFsmPhase упадёт в default.
  | "ig_open_create"       // клик Create(+) → [role="dialog"]
  | "ig_select_file"       // Select from computer → acceptFileChooser → crop-опции
  | "ig_crop_next"         // (опц. crop) → Next #1 → Edit-экран
  | "ig_edit_next"         // Next #2 → caption-поле
  | "ig_caption"           // ввод caption + hashtags
  | "ig_share"             // клик Share
  | "ig_verify"            // перехват shortcode / профиль-верификация

/** YouTube visibility (3 значения как у Studio). */
export type YouTubeVisibility = "public" | "unlisted" | "private"

/** YouTube-specific опции для poster. */
export interface YouTubePosterOptions {
  /** Visibility аудитории. Дефолт fail-safe = "private" задаётся на API-edge, не в poster. */
  visibility: YouTubeVisibility
  /** Made-for-kids — YouTube требует обязательный выбор перед публикацией. */
  madeForKids: boolean
  /** Считается на нашей стороне: Video.format===portrait && duration<60. Добавляет #Shorts в description. */
  isShorts: boolean
}

/**
 * Вход в poster (нейтральный контракт постинга).
 *
 * Этап 2 (DuoPlus): web-специфичные поля `session`/`transport` (CDP/WebDriver
 * browser-session) удалены вместе с browser-session-слоем. Реальный движок
 * автоматизации (AutomationEngine) и его device-канал придут в Этапе 3 — тогда
 * сюда вернётся нейтральный handle (ADB/RPA), не браузерный. Сейчас PostInput
 * остаётся как контракт текстовых/медиа-полей джобы, который знают FSM-каркас и
 * NotImplementedAutomationEngine.
 */
export interface PostInput {
  /**
   * Локальный TCP порт (для логов/debug). Web-специфичное поле — мёртвое на
   * Этапе 2 (browser-session удалён), оставлено информативно до Этапа 3.
   */
  webDriverPort?: number
  /** Полный путь к скачанному видео в os.tmpdir(). */
  videoLocalPath: string
  /**
   * Caption для платформ с единым полем (TikTok / Instagram).
   * Для YouTube — игнорируется, используются title + description.
   */
  caption: string
  /** Hashtags. Платформы решают сами куда вставлять. */
  hashtags?: string[]
  /** YouTube: заголовок видео (≤100 chars). */
  title?: string
  /** YouTube: описание (≤5000 chars; hashtags будут конкатенированы). */
  description?: string
  /** YouTube platform-specific options. Обязателен для platform === "youtube". */
  youtube?: YouTubePosterOptions
  /** PostingJob.id — для имён скриншотов и логов. */
  jobId: string
  /** Платформа (poster обычно знает свою, но dispatcher может проверить). */
  platform: Platform
  /**
   * PR2A observability-наблюдатель фаз. Передаётся poster-runner'ом. При
   * выключенном YOUTUBE_POSTING_FSM_ENABLED — no-op (enabled=false). Постер
   * вызывает fsm?.enterPhase/exitPhase/updateProgress для логирования прогресса,
   * НЕ меняя свою логику.
   */
  fsm?: PhaseObserver
  /**
   * PR4: persisted stateData job'а (progress / draftVideoId / draftUrl /
   * duplicateRiskAcknowledged). Читается poster-runner'ом ПЕРЕД dispatch и
   * передаётся в PhaseRunner для resume_check (resolveResumePlan). undefined —
   * fresh-прогон (нет состояния / первый запуск).
   */
  stateData?: YouTubePostingStateData
  /**
   * Instagram: @-handle аккаунта для профиль-верификации (resume/dedup без
   * черновика). Источник — SocialAccount.platformHandle → fallback
   * loginCheckedUsername (поставляется poster-runner'ом). null/undefined →
   * verify по профилю невозможен → resume-план BLOCK (W5). YouTube не использует.
   */
  igUsername?: string | null
}

/** Результат poster.run(). */
export interface PostResult {
  success: boolean
  /** ID поста на платформе. */
  platformPostId?: string
  /** Канонический URL поста. */
  platformPostUrl?: string
  /** Шаг на котором упало — заполняется когда success=false. */
  phase?: PostingPhase
  /** Сообщение ошибки оператору. */
  errorMessage?: string
  /** storageKey скриншота из zavodcamp/posting-errors/. */
  screenshotKey?: string
  /** Платформа выдала warning о modified content (TikTok может рекомпрессить). */
  apiMadeWarning?: boolean
  /**
   * Чем подтверждена публикация (YouTube success-detection):
   *   - "device_tile"   — плитка опубликованного Short найдена в UI канала на устройстве;
   *   - "channel_fetch" — Short найден серверным fetch публичной страницы канала.
   * Для honest-логирования: пустой platformPostUrl при device_tile — норма (страница
   * канала ещё не проиндексировала свежий Short), а НЕ молчаливый фейк «Опубликовано».
   */
  verificationMethod?: "device_tile" | "channel_fetch"
}

export type Poster = (input: PostInput) => Promise<PostResult>

/**
 * Структурированная ошибка poster'а. throws с этим payload позволяет
 * poster-runner однозначно классифицировать (без regex по message).
 *
 * proxy_dead: добавлено для inline browser_leak_check внутри CDP-сессии.
 * Этот сценарий означает что Chromium показал реальный IP сервера —
 * пост ОТМЕНЁН немедленно, поскольку публикация = гарантированный бан.
 * Не retryable (state-machine не включает proxy_dead в RETRYABLE_CATEGORIES).
 */
export class PostingPhaseError extends Error {
  constructor(
    message: string,
    public readonly phase: PostingPhase,
    public readonly category:
      | "login_required"
      | "browser_connect_failed"
      | "selector_not_found"
      | "upload_failed"
      | "network_error"
      | "proxy_dead"
      // Этап 3 (P5): terminal-ошибки DuoPlus ADB-движка (device config error /
      // нереализованный постер) оборачиваются в PostingPhaseError с этой
      // категорией. categorizeError её распознаёт как terminal (НЕ retryable).
      | "internal_error"
      | "unknown",
    public readonly screenshotKey?: string,
    /**
     * PR4: явный terminal-сигнал resume_check. Когда выставлен — retry-policy
     * маршрутизирует в terminal (НЕ retry, НЕ browser_lost) с этим finalReason,
     * независимо от category/текста. Бросается только runner'ом resume_check
     * (duplicate_blocked / verify не доказал публикацию). undefined для всех
     * обычных ошибок — legacy-путь не затронут.
     */
    public readonly terminalReason?: "duplicate_risk" | "requires_human",
  ) {
    super(message)
    this.name = "PostingPhaseError"
  }
}
