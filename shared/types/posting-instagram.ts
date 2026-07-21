/**
 * Shared-типы для Instagram (Reels) browser automation постинга.
 *
 * Параллель posting-youtube.ts. Сервер использует те же значения для валидации
 * (server/utils/posting/instagram-snapshot-validator.ts), клиент (UI bulk/create,
 * PR6) — для form-state и pre-flight проверок.
 *
 * Ключевое отличие от YouTube: у Instagram НЕТ visibility/madeForKids. Текст —
 * единое поле caption (десктоп-веб всегда делает Reel). Хэштеги в IG входят в
 * то же поле caption, поэтому суммарная длина (caption + конкатенация тегов)
 * считается против одного лимита 2200 символов.
 */

import type { PostingJobDto } from "./posting-job"

/** Лимит длины caption в Instagram (вместе с хэштегами, в одном поле). */
export const INSTAGRAM_CAPTION_MAX = 2200

/** Максимум хэштегов в одном посте Instagram. */
export const INSTAGRAM_HASHTAGS_MAX_COUNT = 30

/** Сводные лимиты Instagram (зеркалит server-side константы). */
export const INSTAGRAM_LIMITS = {
  CAPTION_MAX: INSTAGRAM_CAPTION_MAX,
  HASHTAGS_MAX_COUNT: INSTAGRAM_HASHTAGS_MAX_COUNT,
} as const

/**
 * Instagram namespace внутри contentSnapshot. Поле для будущего —
 * десктоп-веб всё равно публикует видео как Reel, отдельного выбора нет.
 * Мягкая валидация: дефолт shareAsReel = true.
 */
export interface InstagramSnapshotNamespace {
  shareAsReel: boolean
}

/** Полный Instagram contentSnapshot для POST /api/posting-jobs body. */
export interface InstagramContentSnapshot {
  /** Текст подписи (вместе с хэштегами ≤ 2200 символов). */
  caption?: string
  /** Хэштеги без `#`, ≤ 30 шт, каждый без пробелов. */
  hashtags?: string[]
  instagram?: InstagramSnapshotNamespace
}

/**
 * Phase enum для Instagram — порядок отображения в PhaseProgress.
 * Должен совпадать с ig_* значениями PostingPhase в
 * server/automation/posters/types.ts и YouTubePostingPhase.
 */
export const INSTAGRAM_PHASES = [
  "session_start",
  "cdp_connect",
  "browser_leak_check",
  "login_check",
  "navigate_upload",
  "ig_open_create",
  "ig_select_file",
  "ig_crop_next",
  "ig_edit_next",
  "ig_caption",
  "ig_share",
  "ig_verify",
] as const

export type InstagramPhase = (typeof INSTAGRAM_PHASES)[number]

/** Подписи фаз на русском для UI. */
export const INSTAGRAM_PHASE_LABELS: Record<InstagramPhase, string> = {
  session_start: "Старт Indigo сессии",
  cdp_connect: "Подключение CDP",
  browser_leak_check: "Проверка IP в браузере",
  login_check: "Проверка входа в Instagram",
  navigate_upload: "Открытие Instagram",
  ig_open_create: "Открытие диалога создания",
  ig_select_file: "Загрузка видео",
  ig_crop_next: "Кадрирование",
  ig_edit_next: "Редактирование",
  ig_caption: "Подпись (caption)",
  ig_share: "Публикация (Share)",
  ig_verify: "Подтверждение публикации",
}

/**
 * Считает суммарную длину caption + хэштеги так, как это видит Instagram:
 * caption и теги — одно поле. Каждый тег прибавляет `#tag` + разделитель-пробел.
 *
 * Используется и сервером (валидатор), и клиентом (счётчик в UI).
 */
export function computeInstagramCaptionLength(
  caption: string | undefined,
  hashtags: string[] | undefined,
): number {
  // Считаем по той же композиции, что и постер (composeCaption): caption + тег,
  // соединённые одиночными пробелами, затем trim. Длина — в UTF-16 code units
  // (так Instagram считает лимит). Это убирает off-by-one для пустого caption.
  const base = (caption ?? "").trim()
  const tags = (hashtags ?? []).map((t) => (t.startsWith("#") ? t : `#${t}`))
  if (tags.length === 0) return base.length
  const composed = `${base} ${tags.join(" ")}`.trim()
  return composed.length
}

// ---- Builders ----

export interface BuildInstagramSnapshotInput {
  caption: string
  hashtags: string[]
}

/**
 * Строит structured Instagram contentSnapshot для POST /api/posting-jobs body.
 * Единый builder для UploadCreateModal + PostingJobCreateModal (PR6).
 */
export function buildInstagramContentSnapshot(
  input: BuildInstagramSnapshotInput,
): InstagramContentSnapshot {
  const caption = input.caption.trim()
  const snapshot: InstagramContentSnapshot = {
    instagram: { shareAsReel: true },
  }
  if (caption.length > 0) snapshot.caption = caption
  if (input.hashtags.length > 0) snapshot.hashtags = input.hashtags
  return snapshot
}

// ---- Type guards ----

export function isInstagramContentSnapshot(
  raw: unknown,
): raw is InstagramContentSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false
  const obj = raw as Record<string, unknown>
  if (obj.caption !== undefined && typeof obj.caption !== "string") return false
  if (obj.hashtags !== undefined && !Array.isArray(obj.hashtags)) return false
  return true
}

/**
 * Извлекает Instagram contentSnapshot из PostingJobDto если платформа instagram.
 * Возвращает null если snapshot невалиден — UI показывает fallback.
 */
export function extractInstagramSnapshot(
  job: PostingJobDto,
): InstagramContentSnapshot | null {
  if (job.platform !== "instagram") return null
  if (!isInstagramContentSnapshot(job.contentSnapshot)) return null
  return job.contentSnapshot
}
