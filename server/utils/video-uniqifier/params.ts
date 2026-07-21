/**
 * Track F — параметры уникализации видео.
 *
 * Детерминистическая генерация params + хэш для кеширования.
 * Используем существующий XorShift32 из server/utils/warmup/rng.ts,
 * чтобы не дублировать алгоритм seedable RNG.
 */

import { createHash } from "node:crypto"
import { createSeededRng } from "../warmup/rng"

export type UniqifyPlatform = "tiktok" | "youtube"

export interface UniqifyParams {
  /** Constant Rate Factor для libx264, 18..28 разумно. */
  crf: number
  /** Яркость [-0.06..0.06] в filter eq. */
  brightness: number
  /** Контраст [0.95..1.06]. */
  contrast: number
  /** Saturation [0.92..1.08]. */
  saturation: number
  /** Audio tempo [0.97..1.03] — сохраняет pitch (atempo). */
  speed: number
  /** Crop в пикселях с каждой стороны (0..6 px). */
  cropPx: number
  /** Сохраняем seed для воспроизводимости/диагностики. */
  randomSeed: string
}

export interface PlatformPreset {
  /** Целевое разрешение (видео маштабируется, если не совпадает). */
  width: number
  height: number
  fps: number
  preset: "veryfast" | "fast" | "medium"
  /** '128k', '192k' и т.п. */
  audioBitrate: string
}

/**
 * Pre-sets per platform. instagram добавлен для расширяемости — 1080x1920 как Reels;
 * в API endpoint instagram возвращает 400, но preset тут лежит, чтобы не было лишней
 * миграции при включении в будущем.
 */
export const PLATFORM_PRESETS: Record<UniqifyPlatform | "instagram", PlatformPreset> = {
  tiktok:    { width: 1080, height: 1920, fps: 30, preset: "veryfast", audioBitrate: "128k" },
  youtube:   { width: 1080, height: 1920, fps: 30, preset: "fast",     audioBitrate: "192k" },
  instagram: { width: 1080, height: 1920, fps: 30, preset: "veryfast", audioBitrate: "128k" },
}

/**
 * Детерминистическая генерация параметров.
 * Seed формата `<videoId>:<platform>:<saltVersion>` — одинаковый seed → одинаковые params,
 * это и есть основа кеширования.
 */
export function generateUniqifyParams(seed: string): UniqifyParams {
  const rng = createSeededRng(seed)
  return {
    crf:        rng.int(20, 24),
    brightness: roundTo(rng.float() * 0.12 - 0.06, 4), // [-0.06..0.06]
    contrast:   roundTo(0.95 + rng.float() * 0.11, 4), // [0.95..1.06]
    saturation: roundTo(0.92 + rng.float() * 0.16, 4), // [0.92..1.08]
    speed:      roundTo(0.97 + rng.float() * 0.06, 4), // [0.97..1.03]
    cropPx:     rng.int(0, 6),
    randomSeed: seed,
  }
}

function roundTo(v: number, digits: number): number {
  const m = 10 ** digits
  return Math.round(v * m) / m
}

/**
 * sha256 от стабильно-сериализованных параметров. Slice 16 hex —
 * достаточно для имени файла, коллизий в рамках одного videoId+platform
 * практически не бывает (64-bit пространство).
 */
export function hashParams(params: UniqifyParams): string {
  const stable = JSON.stringify({
    crf: params.crf,
    brightness: params.brightness,
    contrast: params.contrast,
    saturation: params.saturation,
    speed: params.speed,
    cropPx: params.cropPx,
  })
  return createHash("sha256").update(stable).digest("hex").slice(0, 16)
}
