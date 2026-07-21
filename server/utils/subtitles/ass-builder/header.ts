/**
 * ASS [Script Info] + [V4+ Styles] generator.
 *
 * libass читает Style.Fontname как family-name, не как filename. Для Montserrat-Bold.ttf
 * пишем `Fontname: Montserrat` + `Bold: -1` — libass подберёт правильный weight из
 * fontsdir.
 *
 * Цвета в ASS: формат `&HAABBGGRR&` (alpha-blue-green-red, БЕЗ R-G-B как в hex). Helper
 * rgbToAssColor конвертирует #RRGGBB[AA] из preset-registry.
 */

import type { FullSubtitlePreset } from '../preset-registry'

export type VideoFormat = 'portrait' | 'landscape'

interface BuildHeaderOptions {
  format: VideoFormat
  preset: FullSubtitlePreset
  fontFamily: string
}

/**
 * Конвертирует hex-цвет (#RRGGBB или #RRGGBBAA) в ASS color string &HAABBGGRR&.
 * Alpha в ASS инвертирован: 00 = непрозрачно, FF = полностью прозрачно.
 */
export function rgbToAssColor(hex: string): string {
  const cleaned = hex.replace('#', '').toUpperCase()
  if (cleaned.length !== 6 && cleaned.length !== 8) {
    return '&H00FFFFFF&'
  }
  const r = cleaned.slice(0, 2)
  const g = cleaned.slice(2, 4)
  const b = cleaned.slice(4, 6)
  const a = cleaned.length === 8
    ? toAssAlpha(cleaned.slice(6, 8))
    : '00'
  return `&H${a}${b}${g}${r}&`
}

/** В CSS alpha hex 00=прозрачно, FF=непрозрачно. В ASS наоборот. Инвертируем. */
function toAssAlpha(hex: string): string {
  const cssAlpha = parseInt(hex, 16)
  if (Number.isNaN(cssAlpha)) return '00'
  const assAlpha = 255 - cssAlpha
  return assAlpha.toString(16).padStart(2, '0').toUpperCase()
}

/**
 * Полный header ASS-файла. PlayResX/Y фиксированы под формат (1080×1920 portrait,
 * 1920×1080 landscape) — fontsize в Style рассчитан под эти PlayRes.
 *
 * ScaledBorderAndShadow: yes — без этого outline и shadow не масштабируются под
 * реальное разрешение видео.
 */
export function buildAssHeader(opts: BuildHeaderOptions): string {
  const { format, preset, fontFamily } = opts
  const isPortrait = format === 'portrait'
  const playResX = isPortrait ? 1080 : 1920
  const playResY = isPortrait ? 1920 : 1080
  const fontSize = isPortrait ? preset.fontSizePortrait : preset.fontSizeLandscape

  const outlineColor = preset.outlineColor
    ? rgbToAssColor(preset.outlineColor)
    : '&H00000000&'
  const backColor = preset.backgroundColor
    ? rgbToAssColor(preset.backgroundColor)
    : '&H00000000&'

  // BorderStyle=1 = outline + shadow, BorderStyle=3 = opaque box (для boxed-пресета).
  const borderStyle = preset.backgroundColor ? 3 : 1
  const outline = preset.outlineWidth
  const shadow = preset.shadowOffset

  // MarginV — отступ сверху/снизу. Для portrait 1080×1920 нужен запас под TikTok UI:
  // 200-260px снизу, 180-300px сверху. Используем 240 px по дефолту.
  const marginV = isPortrait ? 240 : 120
  const marginLR = isPortrait ? 60 : 100

  const bold = preset.bold ? -1 : 0
  // Alignment 2 = bottom-center (стандарт для субтитров).
  const alignment = 2

  // Karaoke pre-fill (стандарт ASS/libass для \kf):
  //   PrimaryColour   — цвет ДО заполнения (inactive words / fill destination).
  //   SecondaryColour — цвет sweep-заполнения (active sweep cursor).
  // libass рисует слова в PrimaryColour и в течение \kf-длительности заливает их
  // SecondaryColour'ом слева направо. Для karaoke-пресета (textColor=base, accentColor=
  // подсветка активного слова) Primary = textColor, Secondary = accentColor.
  // Для остальных пресетов Secondary = Primary (sweep не используется).
  const stylePrimary = rgbToAssColor(preset.textColor)
  const styleSecondary = rgbToAssColor(preset.accentColor ?? preset.textColor)

  const styleLine = [
    'Default',
    fontFamily,
    String(fontSize),
    stylePrimary,
    styleSecondary,
    outlineColor,
    backColor,
    String(bold),
    '0',                  // Italic
    '0',                  // Underline
    '0',                  // StrikeOut
    '100',                // ScaleX
    '100',                // ScaleY
    '0',                  // Spacing
    '0',                  // Angle
    String(borderStyle),  // BorderStyle
    String(outline),      // Outline
    String(shadow),       // Shadow
    String(alignment),    // Alignment
    String(marginLR),     // MarginL
    String(marginLR),     // MarginR
    String(marginV),      // MarginV
    '1',                  // Encoding (1 = Default)
  ].join(',')

  return [
    '[Script Info]',
    '; Сгенерировано ZavodCamp ASS-builder',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${styleLine}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    '',
  ].join('\n')
}
