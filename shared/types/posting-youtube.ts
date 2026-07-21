/**
 * Shared-типы для YouTube browser automation посинга (Фаза 2 UI).
 *
 * Парные сервер/клиент: сервер использует те же значения для валидации
 * (server/utils/posting/youtube-snapshot-validator.ts), клиент — для form-state
 * и pre-flight проверок.
 *
 * Источник правды для контракта visibility/madeForKids — fail-safe принцип:
 * никаких дефолтов. UI обязан явно собрать оба значения у оператора, иначе
 * форма невалидна и сервер вернёт 400.
 */

import type { PostingJobDto } from "./posting-job"

/** Visibility аудитории как в YouTube Studio. */
export type YoutubeVisibility = "public" | "unlisted" | "private"

export const YOUTUBE_VISIBILITY_VALUES: readonly YoutubeVisibility[] = [
  "public",
  "unlisted",
  "private",
] as const

/**
 * YouTube namespace внутри contentSnapshot. Соответствует
 * server/utils/posting/youtube-snapshot-validator.ts и
 * server/automation/posters/types.ts (YouTubePosterOptions).
 *
 * isShorts здесь НЕ хранится — он вычисляется worker'ом из Video.format/duration
 * непосредственно перед стартом poster'а (источник истины — модель Video).
 */
export interface YoutubeSnapshotNamespace {
  visibility: YoutubeVisibility
  madeForKids: boolean
}

/** Полный YouTube contentSnapshot для POST /api/posting-jobs body. */
export interface YoutubeContentSnapshot {
  title: string
  description?: string
  hashtags?: string[]
  youtube: YoutubeSnapshotNamespace
}

/** Лимиты YouTube Studio 2026 (зеркалит server-side константы). */
export const YOUTUBE_LIMITS = {
  TITLE_MAX: 100,
  DESCRIPTION_MAX: 5000,
  HASHTAGS_TOTAL_MAX: 500,
} as const

/**
 * Phase enum для YouTube — порядок отображения в PhaseProgress (12 шагов).
 * Должен совпадать с PostingPhase в server/automation/posters/types.ts.
 *
 * altered_content добавлен в 21.05.2025 — YouTube требует обязательное disclosure
 * для AI-generated контента. ZavodCamp весь контент = YES.
 */
export const YOUTUBE_PHASES = [
  "session_start",
  "cdp_connect",
  "browser_leak_check",
  "login_check",
  "navigate_upload",
  "file_upload",
  "details",
  "altered_content",
  "made_for_kids",
  "visibility",
  "submit",
  "extract_url",
] as const

export type YoutubePhase = (typeof YOUTUBE_PHASES)[number]

/** Подписи фаз на русском для UI. */
export const YOUTUBE_PHASE_LABELS: Record<YoutubePhase, string> = {
  session_start: "Старт Indigo сессии",
  cdp_connect: "Подключение CDP",
  browser_leak_check: "Проверка IP в браузере",
  login_check: "Проверка входа в YouTube",
  navigate_upload: "Открытие YouTube Studio",
  file_upload: "Загрузка видео",
  details: "Заголовок и описание",
  altered_content: "Disclosure AI-контента",
  made_for_kids: "Возрастная аудитория",
  visibility: "Видимость публикации",
  submit: "Публикация",
  extract_url: "Получение URL",
}

// ---- Pre-flight типы ----

/**
 * Один пункт чек-листа pre-flight (видео/прокси/indigo/login/caption).
 * level определяет UI-окраску и блокирует ли submit.
 */
export interface PreflightCheck {
  /** Уникальный ключ для list-key в шаблоне. */
  key: string
  /** Человекочитаемое название проверки на русском. */
  label: string
  /** Текущее состояние. */
  status: "ok" | "warn" | "blocker" | "loading"
  /** Краткое описание состояния (что не так / что ok). */
  detail?: string
  /** Текст кнопки действия для исправления (если есть). */
  actionLabel?: string
  /** Тип действия — UI решает обработчик. */
  actionType?:
    | "run_login_check"
    | "open_indigo_profile"
    | "open_caption_editor"
    | "run_deep_check"
    | "select_proxy"
    | "select_video"
}

/** Полное состояние pre-flight для рендера чек-листа и кнопки submit. */
export interface PreflightState {
  checks: PreflightCheck[]
  /** true если есть хотя бы один blocker — submit заблокирован. */
  blocking: boolean
  /** Идёт ли первичная загрузка чек-листа. */
  loading: boolean
}

/**
 * Account-level readiness для quick-glance бейджа (4-точечный чек-лист).
 * Лёгкая версия без video/caption — учитывает только proxy/indigo/login/deep.
 */
export interface AccountReadinessCheck {
  key: "proxy" | "indigo" | "deep_check" | "login"
  label: string
  passed: boolean
  detail?: string
  /**
   * Проверка заморожена на время миграции DuoPlus (Этап 3): login-check и deep-check
   * через CDP-браузер сняты, device-проверка сессии еще не реализована. Замороженная
   * проверка НЕ блокирует готовность (исключается из score/total) и рисуется
   * нейтрально, а не как провал - чтобы UI не врал «не залогинен».
   */
  frozen?: boolean
}

export interface AccountReadinessState {
  checks: AccountReadinessCheck[]
  /** Сколько НЕ-замороженных проверок прошло. */
  score: number
  /** Сколько НЕ-замороженных проверок всего (замороженные миграцией исключены из гейта). */
  total: number
  /** true если все не-заморожённые проверки прошли. */
  ready: boolean
  loading: boolean
}

// ---- Builders & parsers (shared между UploadCreateModal и PostingJobCreateModal) ----

/**
 * Парсит raw input (текстовое поле "хэштеги" с произвольным разделителем) в
 * нормализованный массив строк БЕЗ префикса `#`.
 *
 * Источник правды: poster при composeDescription добавит `#` сам. Если массив
 * уже с `#`, получим `##fyp` — публикация будет уродливой. Поэтому стрипаем
 * `#` на входе один раз.
 *
 * Поддерживает оба формата разделителя: запятая и whitespace. Это совпадает
 * с поведением которое было в PostingJobCreateModal — теперь и Upload и
 * Posting используют одно.
 */
export function parseHashtagsInput(raw: string): string[] {
  if (!raw || typeof raw !== "string") return []
  return raw
    .split(/[\s,]+/)
    .map((s) => s.replace(/^#+/, "").trim())
    .filter((s) => s.length > 0)
}

export interface BuildYoutubeSnapshotInput {
  title: string
  description: string
  hashtags: string[]
  visibility: YoutubeVisibility
  madeForKids: boolean
}

/**
 * Строит structured YouTube contentSnapshot для POST /api/posting-jobs body.
 *
 * Единый builder для UploadCreateModal + PostingJobCreateModal. Любое
 * изменение контракта (новое поле в youtube namespace, новые лимиты) правится
 * в одном месте. Серверный validateYoutubeSnapshot читает тот же shape.
 *
 * Тримит/слайсит до safe границ (back-stop валидация на edge, сервер всё равно
 * вернёт 400 если лимиты превышены).
 */
export function buildYoutubeContentSnapshot(
  input: BuildYoutubeSnapshotInput,
): YoutubeContentSnapshot {
  const title = input.title.trim().slice(0, YOUTUBE_LIMITS.TITLE_MAX)
  const description = input.description.trim().slice(0, YOUTUBE_LIMITS.DESCRIPTION_MAX)
  const snapshot: YoutubeContentSnapshot = {
    title,
    youtube: {
      visibility: input.visibility,
      madeForKids: input.madeForKids,
    },
  }
  if (description.length > 0) snapshot.description = description
  if (input.hashtags.length > 0) snapshot.hashtags = input.hashtags
  return snapshot
}

/**
 * Generic contentSnapshot для платформ с единым text-полем (TikTok/Instagram).
 * Не имеет platform-specific namespace.
 */
export interface GenericContentSnapshot {
  caption: string | null
  description: string | null
  hashtags: string[]
}

export function buildGenericContentSnapshot(input: {
  caption: string
  description: string
  hashtags: string[]
}): GenericContentSnapshot {
  return {
    caption: input.caption.trim() || null,
    description: input.description.trim() || null,
    hashtags: input.hashtags,
  }
}

// ---- Type guards ----

export function isYoutubeContentSnapshot(
  raw: unknown,
): raw is YoutubeContentSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false
  const obj = raw as Record<string, unknown>
  if (typeof obj.title !== "string") return false
  if (!obj.youtube || typeof obj.youtube !== "object") return false
  const yt = obj.youtube as Record<string, unknown>
  if (typeof yt.visibility !== "string") return false
  if (!(YOUTUBE_VISIBILITY_VALUES as readonly string[]).includes(yt.visibility)) {
    return false
  }
  if (typeof yt.madeForKids !== "boolean") return false
  return true
}

/**
 * Извлекает youtube namespace из contentSnapshot PostingJobDto если платформа youtube.
 * Возвращает null если snapshot невалиден — UI должен показать fallback (без бейджей).
 */
export function extractYoutubeSnapshot(
  job: PostingJobDto,
): YoutubeContentSnapshot | null {
  if (job.platform !== "youtube") return null
  if (!isYoutubeContentSnapshot(job.contentSnapshot)) return null
  return job.contentSnapshot
}
