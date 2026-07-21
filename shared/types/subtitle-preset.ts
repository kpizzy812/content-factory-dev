/**
 * Типы пресетов субтитров.
 *
 * Лежат в shared/, чтобы и UI (через useSubtitlePresets), и сервер (preset-registry)
 * импортировали один источник истины. Полное описание (animation tags, render-параметры)
 * живёт в server/utils/subtitles/preset-registry.ts — здесь только публичный union ключей
 * и meta-структура для UI.
 *
 * Backward-compat: старые ключи (tiktok_classic, minimal, ...) НЕ удалены из union, чтобы
 * Video.subtitlePreset из БД продолжал валидироваться. Маппинг старый → новый делает
 * preset-registry через LEGACY_ALIASES.
 */

export type SubtitlePresetKey =
  | 'classic'
  | 'tiktok_white'
  | 'tiktok_neon'
  | 'karaoke'
  | 'hormozi'
  | 'beast'
  | 'wave'
  | 'popup'
  | 'minimal_subtle'
  | 'boxed'

/** Legacy ключи остаются принимаемыми (валидируются как известные) и резолвятся через alias. */
export type LegacySubtitlePresetKey =
  | 'tiktok_classic'
  | 'tiktok_bold_yellow'
  | 'tiktok_boxed'
  | 'minimal'

export type AnySubtitlePresetKey = SubtitlePresetKey | LegacySubtitlePresetKey

export const DEFAULT_SUBTITLE_PRESET: SubtitlePresetKey = 'classic'

/** Renderer выбирает между быстрым drawtext (без анимаций) и libass (анимации, karaoke). */
export type SubtitleRenderer = 'drawtext' | 'ass'

export type SubtitlePresetTag =
  | 'classic'
  | 'bold'
  | 'neon'
  | 'minimal'
  | 'animated'
  | 'karaoke'
  | 'creator-style'

/** Метаданные пресета — публикуются через GET /api/subtitles/presets, потребляются UI. */
export interface SubtitlePresetMeta {
  key: SubtitlePresetKey
  label: string
  description: string
  tags: SubtitlePresetTag[]
  renderer: SubtitleRenderer
  /** AI-keyword-detector нужен чтобы выделить акцентные слова (числа, hooks). */
  needsKeywordDetection: boolean
  /** Семейство шрифта (имя должно совпадать с family внутри TTF в storage/fonts/). */
  fontFamily: 'Anton' | 'Montserrat' | 'Inter' | 'system'
  /** Превью-видео в public/subtitle-presets/{key}.mp4 — null если ещё не сгенерировано. */
  sampleVideoUrl: string | null
  /** Превью-картинка fallback, null если нет. */
  sampleImageUrl: string | null
  /** Цвет текста по умолчанию для CSS-имитации в UI картинке. */
  previewTextColor: string
  /** Цвет акцента для CSS-имитации (highlight на 1 слове). */
  previewAccentColor: string | null
  /** Текст метки в карточке, например "AI ~$0.001/видео". */
  previewExtraNote: string | null
}
