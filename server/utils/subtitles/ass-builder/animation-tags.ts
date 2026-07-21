/**
 * Pure-функции для генерации ASS animation-tags.
 *
 * Возвращают строки вида `{\fad(150,150)}` — caller вставляет их в начало Dialogue.Text
 * или вокруг конкретного слова. Все функции stateless и тестируемы изолированно.
 *
 * Reference: https://aegisub.org/docs/latest/ass_tags/
 */

import { rgbToAssColor } from './header'

export type EntranceKind = 'none' | 'fade_short' | 'fade_long' | 'pop' | 'slide_up'
export type EmphasisKind = 'none' | 'color' | 'color_scale' | 'karaoke_sweep'
export type EffectKind = 'none' | 'glow' | 'wave'

/**
 * Тег entrance-анимации, применяется ко всему сегменту в начале Dialogue.Text.
 * Возвращает пустую строку для 'none' — caller просто не префиксит.
 */
export function entranceTag(entrance: EntranceKind, durationSec: number): string {
  switch (entrance) {
    case 'fade_short':
      return '{\\fad(150,150)}'
    case 'fade_long':
      return '{\\fad(300,300)}'
    case 'pop':
      // Pop-in: масштаб 60% → 100% за 200мс с easeOut. accel=0.7 даёт лёгкий bounce.
      return '{\\fscx60\\fscy60\\t(0,200,0.7,\\fscx100\\fscy100)\\fad(120,80)}'
    case 'slide_up': {
      // Slide-up: смещение Y +30 → 0 за 250мс. \move работает с абсолютными координатами,
      // так что используем \org+\frz hack — нет, правильно через \pos+\move невозможно для
      // динамической позиции. Вместо этого комбинируем \fad + плавное \fry для иллюзии.
      // ПРАВИЛЬНО: используем \move на родственных текущей позиции — но позиция выводится
      // libass'ом из MarginV. Здесь применяем простой \fad + \frx для иллюзии входа.
      // По факту наиболее надёжно: \fad + быстрый scale animation (как pop, но мягче).
      const _ = durationSec
      return '{\\fscx100\\fscy90\\t(0,250,\\fscy100)\\fad(180,80)}'
    }
    case 'none':
    default:
      return ''
  }
}

/**
 * Тег смены primary-цвета через \1c. Возвращает строку вида `{\1c&HBBGGRR&}` без trailing
 * амперсанда у второго `&` (rgbToAssColor отдаёт `&HAABBGGRR&`, мы убираем закрывающий
 * `&` и подставляем свой, чтобы вписать тег в ASS-блок без double-`&&`).
 */
export function colorTag(hex: string): string {
  return `{\\1c${rgbToAssColor(hex).slice(0, -1)}&}`
}

/**
 * Tag для emphasis на одиночное слово. Returns пустую строку если emphasis 'none'.
 * baseDurMs — длительность слова в мс, для тайминга scale-анимации.
 */
export function emphasisTag(
  emphasis: EmphasisKind,
  accentColor: string | null,
  baseDurMs: number,
): string {
  if (emphasis === 'none' || !accentColor) return ''

  switch (emphasis) {
    case 'color':
      return colorTag(accentColor)
    case 'color_scale': {
      // Pop scale 130%→100% за 60% длительности слова + цвет акцента. Объединяем colorTag
      // с scale-анимацией в один override-блок (убираем фигурные скобки у colorTag).
      const popMs = Math.max(120, Math.min(300, Math.round(baseDurMs * 0.6)))
      const colourInner = colorTag(accentColor).slice(1, -1)
      return `{${colourInner}\\fscx130\\fscy130\\t(0,${popMs},\\fscx100\\fscy100)}`
    }
    case 'karaoke_sweep':
      // Karaoke handled отдельно через \k тег в dialogue.ts — здесь noop.
      return ''
    default:
      return ''
  }
}

/** \k тег для karaoke. duration в сантисекундах (centiseconds). */
export function karaokeTag(durationCs: number): string {
  const cs = Math.max(1, Math.round(durationCs))
  return `{\\kf${cs}}`
}

/**
 * Glow-эффект для neon-пресета. Применяется ко всему сегменту через blur+border.
 * libass поддерживает \blur (gaussian blur на text+border) — даёт неоновое свечение.
 */
export function glowTag(blurAmount: number, glowColor: string): string {
  const colour = rgbToAssColor(glowColor).slice(0, -1)
  // \3c — outline color (acts as glow halo when blurred)
  return `{\\3c${colour}&\\blur${blurAmount}}`
}

/**
 * Wave-эффект — медленное вращение вокруг центра. Используем \frz с \t для синусоиды
 * через несколько ключевых точек.
 */
export function waveEffectTag(durationSec: number): string {
  const totalMs = Math.round(durationSec * 1000)
  const quarter = Math.round(totalMs / 4)
  const half = Math.round(totalMs / 2)
  const threeQuarter = Math.round(totalMs * 3 / 4)
  return `{\\frz0\\t(0,${quarter},\\frz3)\\t(${quarter},${half},\\frz0)\\t(${half},${threeQuarter},\\frz-3)\\t(${threeQuarter},${totalMs},\\frz0)}`
}

/**
 * Сборка эффекта (glow/wave/none) в один тег для применения в начале сегмента.
 */
export function effectTag(
  effect: EffectKind,
  accentColor: string | null,
  durationSec: number,
): string {
  switch (effect) {
    case 'glow':
      return glowTag(4, accentColor || '#00FFFF')
    case 'wave':
      return waveEffectTag(durationSec)
    case 'none':
    default:
      return ''
  }
}

/**
 * Компонует entrance + effect в один tag-блок. {\tag1\tag2\...} — несколько тегов
 * можно объединить в одних фигурных скобках.
 */
export function combineSegmentTags(parts: string[]): string {
  const inner = parts
    .map(p => p.replace(/^\{|\}$/g, ''))
    .filter(p => p.length > 0)
    .join('')
  return inner ? `{${inner}}` : ''
}
