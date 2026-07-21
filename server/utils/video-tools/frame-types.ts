/**
 * Типы для frame extraction pipeline (Этап 2 модернизации Video Analyzer).
 *
 * Отделены от существующего `ffmpeg.ts` чтобы не тащить fluent-ffmpeg в новые
 * модули (`frame-strategy.ts`, `scene-detect.ts`, `frame-storage.ts`),
 * и наоборот — чтобы не ломать legacy Idea-flow при правках типов.
 */

export interface SceneBoundary {
  /** Время сцены в секундах от начала видео. Округлено до 2 знаков. */
  timestampSec: number
}

export interface PickedTimestamp {
  /** 0-based индекс кадра (после dedup и sort). */
  sequence: number
  /** Финальный timestamp (после snap к scene boundary либо равномерный). */
  timestampSec: number
  /** true если timestamp был snapped к ffmpeg `select=gt(scene,...)` boundary. */
  isSceneBoundary: boolean
}

export interface ExtractedFrameRich {
  /** 0-based порядковый номер кадра в выводе. */
  sequence: number
  /** Абсолютный путь к JPG на диске (`<frameDir>/<sequence>.jpg`). */
  filePath: string
  /** Time offset кадра в исходном видео (секунды). */
  timestampSec: number
  /** Размер JPG в байтах (после возможного re-extract при oversize). */
  bytes: number
  /** Ширина после `-vf scale=W:-2`. null если не удалось извлечь. */
  width: number | null
  /** Высота. null если не парсили (ffprobe spawn опционален). */
  height: number | null
  isSceneBoundary: boolean
}
