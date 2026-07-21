/**
 * Font resolver для ASS-рендерера.
 *
 * libass находит шрифты через filter parameter `subtitles=...:fontsdir=<path>`. Это снимает
 * зависимость от системного fontconfig — шрифты лежат в storage/fonts/ и подхватываются
 * libass'ом по family-name из ASS Style.Fontname.
 *
 * Family name внутри TTF, а НЕ имя файла, определяет какой файл libass возьмёт. См.
 * storage/fonts/README.md.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FullSubtitlePreset } from './preset-registry'

let _cachedFontsDir: string | null | undefined

/**
 * Абсолютный путь к storage/fonts/ если директория существует и содержит хотя бы один
 * валидный шрифт. Иначе null — caller должен будет фолбэкнуть на drawtext.
 *
 * Кэшируется на процесс — переоткрытие через restart сервера.
 */
export function resolveFontsDir(): string | null {
  if (_cachedFontsDir !== undefined) return _cachedFontsDir

  const dir = join(process.cwd(), 'storage', 'fonts')
  if (!existsSync(dir)) {
    _cachedFontsDir = null
    return null
  }
  const requiredOneOf = [
    'Anton-Regular.ttf',
    'Montserrat-Bold.ttf',
    'Inter-Bold.otf',
    'Inter-Bold.ttf',
  ]
  const hasAnyFont = requiredOneOf.some(name => existsSync(join(dir, name)))
  if (!hasAnyFont) {
    _cachedFontsDir = null
    return null
  }
  _cachedFontsDir = dir
  return dir
}

/**
 * Возвращает family name пресета и абсолютный fontsdir для FFmpeg subtitles= filter.
 * Если кастомные шрифты недоступны (storage/fonts пуст) — отдаёт system family (Sans),
 * libass возьмёт системный fontconfig с DejaVu/Noto fallback.
 */
export function getFontForPreset(preset: FullSubtitlePreset): {
  family: string
  fontsDir: string | null
} {
  const fontsDir = resolveFontsDir()

  if (preset.fontFamily === 'system' || !fontsDir) {
    return { family: 'Sans', fontsDir }
  }
  return { family: preset.fontFamily, fontsDir }
}
