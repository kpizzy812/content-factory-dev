/**
 * Точка переключения render-pipeline'а на ASS. Принимает входные данные сегментов и
 * preset, генерирует .ass файл, возвращает готовый FFmpeg filter для подключения через
 * `subtitles=...:fontsdir=...`.
 *
 * При ошибке генерации возвращает null — caller (render.ts) фолбэкается на drawtext.
 */

import { generateAssFile, AssGenerationError } from './ass-builder'
import type { AssSegmentInput } from './ass-builder/dialogue'
import type { FullSubtitlePreset } from './preset-registry'
import type { SubtitleStyleProfile } from '~~/shared/types/story'

export interface AssRenderInput {
  videoId: number
  format: 'portrait' | 'landscape'
  preset: FullSubtitlePreset
  styleOverrides: SubtitleStyleProfile
  segments: AssSegmentInput[]
}

export interface AssRenderResult {
  /** Готовая filter-строка для FFmpeg, например `subtitles='/path/to/file.ass':fontsdir='/path/fonts'`. */
  filterStr: string
  /** Абсолютный путь к .ass для логов / cleanup. */
  assPath: string
  fontsDir: string | null
  warnings: string[]
}

let _warnedFontsdirMissing = false

/**
 * Генерирует ASS-файл и собирает filter-строку. Возвращает null при ошибке (caller
 * должен сделать fallback на drawtext).
 */
export async function tryRenderAssFilter(
  opts: AssRenderInput,
): Promise<AssRenderResult | null> {
  try {
    const result = await generateAssFile({
      videoId: opts.videoId,
      format: opts.format,
      preset: opts.preset,
      styleOverrides: opts.styleOverrides,
      segments: opts.segments,
    })

    if (!result.fontsDir && opts.preset.fontFamily !== 'system' && !_warnedFontsdirMissing) {
      _warnedFontsdirMissing = true
      console.warn(`[subtitles] storage/fonts недоступен; libass возьмёт системный fallback для ${opts.preset.fontFamily}`)
    }

    const escapedAssPath = escapeForSubtitlesFilter(result.filePath)
    const fontsDirPart = result.fontsDir
      ? `:fontsdir=${escapeForSubtitlesFilter(result.fontsDir)}`
      : ''
    const filterStr = `subtitles=${escapedAssPath}${fontsDirPart}`

    return {
      filterStr,
      assPath: result.filePath,
      fontsDir: result.fontsDir,
      warnings: result.warnings,
    }
  } catch (err) {
    const reason = err instanceof AssGenerationError
      ? err.message
      : err instanceof Error ? err.message : String(err)
    console.warn(`[subtitles] ASS-генерация упала, fallback на drawtext: ${reason}`)
    return null
  }
}

/**
 * Escape абсолютного пути для использования в `subtitles=` FFmpeg filter:
 * - `\` → `\\\\` (двойной escape: один для filtergraph, один для libass)
 * - `:` → `\\:` (двоеточие — разделитель опций filter)
 * - `'` → `\\\''` (одинарная кавычка — закрывает quoted-string)
 *
 * Путь обрамляем одинарными кавычками — это идиома FFmpeg для путей с пробелами.
 */
function escapeForSubtitlesFilter(path: string): string {
  const escaped = path
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
  return `'${escaped}'`
}
