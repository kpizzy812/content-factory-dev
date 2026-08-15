import {
  LIMITER_CEILING,
  buildLoudnormApplyFilter,
  measureLoudness,
} from "./video-tools/loudness"
import ffmpeg from "fluent-ffmpeg"
import { writeFile, mkdir, access, unlink, stat } from "node:fs/promises"
import { join, dirname } from "node:path"
import { getAssetsDirFor, getVideosBase } from "./storage-paths"
import type { SubtitleStyleProfile } from "~~/shared/types/story"
import {
  SUBTITLE_WORDS_PER_LINE_MIN,
  SUBTITLE_WORDS_PER_LINE_MAX,
  SUBTITLE_WORDS_PER_LINE_DEFAULT,
} from "~~/shared/types/story"
import type { AnySubtitlePresetKey } from "~~/shared/types/subtitle-preset"
import { getPresetByKey } from "./subtitles/preset-registry"
import { buildShotVariationFilter, pickShotVariationPlan } from "./video-tools/shot-variation"
import { tryRenderAssFilter } from "./subtitles/render-ass"
import { chunkSceneSpeech, maxCharsForWidth } from "./subtitles/phrase-chunker"
import { normalizeSubtitleStyle } from "./subtitle-style"
import { buildSubtitleTimeline, type SceneSubtitleInput } from "./subtitles/scene-timeline"

interface AssembleOptions {
  clips: string[]
  /** Текст-вопрос/идея — отображается СВЕРХУ экрана (hook) */
  topText: string
  /** Текст-ответ/CTA — отображается СНИЗУ экрана */
  bottomText: string
  musicPath: string | null
  format: "portrait" | "landscape"
  outputPath: string
  /** Per-scene субтитры с ЯВНЫМ sceneIndex (story-driven mode).
   * sceneIndex — позиция сцены в videoPlan.scenes, она же индекс клипа в clips[].
   * Без него сцена с пустым текстом сдвигала весь хвост субтитров на сцену вперёд. */
  sceneSubtitles?: SceneSubtitleInput[]
  /** SubtitleStyleProfile из StoryPlan — используется только для casing/длины строки, цвета игнорируем */
  subtitleStyle?: SubtitleStyleProfile | null
  /** Brand-safe preset субтитров — цвета/обводка/размер. Дефолт classic (legacy alias tiktok_classic тоже работает). */
  subtitlePreset?: AnySubtitlePresetKey
  /** AI-keywords (subtitle-keyword-agent) для пресетов с needsKeywordDetection. */
  keywordHints?: Array<{ order: number; keywords: Array<{ word: string; weight: number }> }>
  /** Pre-mixed voiceover audio track, timing уже выравнен под clip boundaries */
  voiceoverPath?: string | null
  /** Громкость музыки когда voiceover выключен (0..1) */
  musicVolume?: number
  /** Громкость музыки когда voiceover включён (duck) */
  musicVolumeWithVoiceover?: number
  /** Громкость clip-native audio когда voiceover включён (attenuate) */
  clipVolumeWithVoiceover?: number
  /**
   * Отрезки таймлайна, где реально звучит закадровый голос. Если заданы, звук
   * клипов приглушается только внутри них: сцену, где ведущая говорит в кадре,
   * глушить нельзя — её голос и есть содержание сцены.
   */
  voiceoverIntervals?: Array<{ startSec: number; endSec: number }>
}

interface AssembleResult {
  filePath: string
  duration: number
}

/** Маппинг SubtitleStyleProfile → параметры drawtext FFmpeg */
interface DrawtextStyle {
  fontSize: number
  fontColor: string
  borderWidth: number
  borderColor: string
  /** Позиция: 'top' | 'center' | 'bottom' */
  position: string
  /** Лимит на строку: число слов (mode=words) или символов (mode=chars) */
  wrapLimit: number
  wrapMode: 'words' | 'chars'
  /** Background box (если задан backgroundColor) */
  boxEnabled: boolean
  boxColor: string
  /** Доп. drop shadow через shadowcolor/shadowx/shadowy (отделяет текст от фона) */
  shadowEnabled: boolean
  shadowColor: string
  shadowOffset: number
}

/**
 * Legacy alias — задаёт прежний union ключей пресетов.
 * Новые пресеты определены в shared/types/subtitle-preset.ts (SubtitlePresetKey).
 * Этот тип сохранён для backward-compat импорта `SubtitlePresetId` из старого кода;
 * фактически принимает любой ключ, известный preset-registry (новые + legacy aliases).
 */
export type SubtitlePresetId = AnySubtitlePresetKey

/** Локально используется только внутри render.ts; публичный default — в shared/types/subtitle-preset.ts. */
const DEFAULT_SUBTITLE_PRESET: SubtitlePresetId = 'classic'

/**
 * Локальный SubtitlePresetDef для drawtext fast-path. Используется ТОЛЬКО когда renderer
 * = 'drawtext' (preset 'classic' сейчас). Остальные пресеты идут через ASS — см.
 * server/utils/subtitles/preset-registry.ts.
 */
interface DrawtextPresetDef {
  fontColor: string
  borderWidth: number
  borderColor: string
  fontSizePortrait: number
  fontSizeLandscape: number
  boxEnabled: boolean
  boxColor: string
  shadowEnabled: boolean
  shadowColor: string
  shadowOffset: number
}

const DRAWTEXT_FALLBACK_PRESET: DrawtextPresetDef = {
  fontColor: 'white',
  borderWidth: 7,
  borderColor: 'black',
  fontSizePortrait: 62,
  fontSizeLandscape: 48,
  boxEnabled: false,
  boxColor: 'black@0.5',
  shadowEnabled: true,
  shadowColor: 'black@0.6',
  shadowOffset: 2,
}

/**
 * Создает директорию если она не существует.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

/**
 * Возвращает путь к директории для ассетов видео.
 */
export function getAssetsDir(videoId: number): string {
  return getAssetsDirFor(videoId)
}

/**
 * Возвращает путь к директории для готовых видео.
 */
export function getVideosDir(): string {
  return getVideosBase()
}

/**
 * Проверяет, существует ли файл.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Проверяет, что аудиофайл реально пригоден для ffmpeg-input: существует и
 * имеет ненулевой размер. Раньше render просто проверял `!!musicPath` (строка
 * не пуста), а потом ffmpeg либо тихо собирал mp4 без звука, либо падал на
 * невалидном файле — в обоих случаях пользователь получал тихое видео без
 * понимания причины.
 */
async function isUsableAudioFile(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false
  try {
    const stats = await stat(filePath)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

/**
 * Резолвит стиль субтитров. Приоритет источников (от высокого к низкому):
 *   1. SubtitleStyleProfile от Claude / pipeline-level — креативные решения
 *   2. Preset (если стиль не задан или провалил readability validation)
 *
 * Claude свободен в выборе цветов и оформления, но прогоняется через
 * `clampForReadability`: контраст, минимальные размеры, толщина обводки.
 * Если профиль не проходит — заменяется на безопасный preset, чтобы
 * субтитры остались видимыми в любом сценарии.
 */
function resolveSubtitleStyle(
  format: "portrait" | "landscape",
  profile?: SubtitleStyleProfile | null,
  position?: string,
  _presetId: SubtitlePresetId = DEFAULT_SUBTITLE_PRESET,
): DrawtextStyle {
  const isPortrait = format === "portrait"
  // Drawtext-fallback использует фиксированный brand-safe пресет — он применяется ТОЛЬКО
  // когда render идёт через drawtext (preset 'classic' либо ASS-fallback). Остальные
  // пресеты рендерит ASS-pipeline и сюда не попадают.
  const preset = DRAWTEXT_FALLBACK_PRESET

  const style: DrawtextStyle = {
    fontSize: isPortrait ? preset.fontSizePortrait : preset.fontSizeLandscape,
    fontColor: preset.fontColor,
    borderWidth: preset.borderWidth,
    borderColor: preset.borderColor,
    position: position || "bottom",
    // Дефолт - SUBTITLE_WORDS_PER_LINE_DEFAULT (4) слов на строку — TikTok/Reels стандарт.
    // Word-based стабильнее char-based: текст всегда умещается в safe-zone независимо от
    // длины слов. Профиль может переопределить через typography.wordsPerLine (clamp 3..6).
    wrapLimit: SUBTITLE_WORDS_PER_LINE_DEFAULT,
    wrapMode: 'words',
    boxEnabled: preset.boxEnabled,
    boxColor: preset.boxColor,
    shadowEnabled: preset.shadowEnabled,
    shadowColor: preset.shadowColor,
    shadowOffset: preset.shadowOffset,
  }

  if (!profile) return style

  // wordsPerLine — единая точка истины. Без него используется default,
  // chars-mode legacy НЕ применяется (раньше maxLineLength=40 ломал defaults).
  const rawWords = profile.typography?.wordsPerLine
  if (typeof rawWords === 'number' && Number.isFinite(rawWords)) {
    style.wrapLimit = Math.max(
      SUBTITLE_WORDS_PER_LINE_MIN,
      Math.min(SUBTITLE_WORDS_PER_LINE_MAX, Math.round(rawWords)),
    )
    style.wrapMode = 'words'
  }
  if (profile.typography?.casing === "uppercase") {
    style.fontSize = Math.round(style.fontSize * 0.9)
  }

  // Visual — Claude решает, validator clampует под минимумы читаемости
  if (profile.visual?.primaryColor) {
    style.fontColor = mapColorToFFmpeg(profile.visual.primaryColor)
  }
  if (profile.visual?.outlineColor) {
    style.borderColor = mapColorToFFmpeg(profile.visual.outlineColor)
  }
  if (profile.visual?.backgroundColor) {
    style.boxEnabled = true
    style.boxColor = mapColorToFFmpegWithAlpha(profile.visual.backgroundColor)
  }
  if (profile.visual?.shadowEnabled !== undefined) {
    style.shadowEnabled = profile.visual.shadowEnabled
  }

  return clampForReadability(style, preset, isPortrait)
}

/**
 * Гарантирует минимальный контраст fontColor↔borderColor, минимальный размер шрифта
 * и толщину обводки. Если стиль провалил какое-то требование — соответствующее
 * поле возвращается к preset-значению. Не трогает поля, которые уже ОК.
 */
function clampForReadability(
  style: DrawtextStyle,
  preset: DrawtextPresetDef,
  isPortrait: boolean,
): DrawtextStyle {
  const minFontSize = isPortrait ? 48 : 38
  const minBorderWidth = 4
  const minContrast = 3.0 // WCAG AA для крупного текста

  // Размер
  if (style.fontSize < minFontSize) {
    style.fontSize = isPortrait ? preset.fontSizePortrait : preset.fontSizeLandscape
  }

  // Толщина обводки
  if (style.borderWidth < minBorderWidth) {
    style.borderWidth = preset.borderWidth
  }

  // Контраст текста и обводки. Если плохо → откатываем оба поля к preset
  // (преимущество: preset гарантированно читаем, не разбираем гибридные кейсы).
  const contrast = colorContrast(style.fontColor, style.borderColor)
  if (contrast < minContrast) {
    style.fontColor = preset.fontColor
    style.borderColor = preset.borderColor
  }

  return style
}

/** WCAG relative luminance contrast ratio. Принимает hex или CSS-имена. */
function colorContrast(c1: string, c2: string): number {
  const l1 = relativeLuminance(c1)
  const l2 = relativeLuminance(c2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: string): number {
  const rgb = parseColorRGB(color)
  if (!rgb) return 0.5 // unknown → assume neutral
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function parseColorRGB(color: string): [number, number, number] | null {
  if (!color) return null
  const c = color.trim().toLowerCase()
  // hex #RRGGBB или #RRGGBBAA — берём только RGB
  const hex = c.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/)
  if (hex) {
    const h = hex[1]!
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]
  }
  // CSS-имена — минимальный набор для проверки
  const named: Record<string, [number, number, number]> = {
    white: [255, 255, 255],
    black: [0, 0, 0],
    red: [255, 0, 0],
    yellow: [255, 255, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    cyan: [0, 255, 255],
    magenta: [255, 0, 255],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
  }
  return named[c] ?? null
}

/**
 * Маппит CSS-like color string на FFmpeg-совместимый формат.
 */
function mapColorToFFmpeg(color: string): string {
  if (!color) return "white"
  const c = color.trim().toLowerCase()
  if (c.startsWith("#") || /^[a-z]+$/.test(c)) return c
  return "white"
}

/**
 * Маппит color with alpha hint на FFmpeg box format.
 */
function mapColorToFFmpegWithAlpha(color: string): string {
  if (!color) return "black@0.5"
  const c = color.trim().toLowerCase()
  // Handle #RRGGBBAA format
  if (c.startsWith("#") && c.length === 9) {
    const hex = c.slice(1, 7)
    const alpha = parseInt(c.slice(7, 9), 16) / 255
    return `#${hex}@${alpha.toFixed(2)}`
  }
  if (c.startsWith("#")) return `${c}@0.6`
  return `${c}@0.5`
}

// Diagnose font: автодетект первого подходящего ttf с поддержкой кириллицы.
// Без fontfile ffmpeg использует встроенный fallback, который рисует неподдерживаемые
// символы пустыми квадратами. Кэшируем выбор на процесс.
let _resolvedSubtitleFont: string | null | undefined
function resolveSubtitleFont(): string | null {
  if (_resolvedSubtitleFont !== undefined) return _resolvedSubtitleFont
  const candidates = [
    '/usr/share/fonts/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/noto/NotoSansDisplay-Regular.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
  ]
  for (const path of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      if (require('node:fs').existsSync(path)) {
        _resolvedSubtitleFont = path
        return path
      }
    } catch { /* skip */ }
  }
  _resolvedSubtitleFont = null
  return null
}

// Удаляет emoji и pictographic символы — drawtext-шрифты их не рендерят
// и в субтитрах появляются "квадратики missing glyph". Claude иногда вставляет
// эмодзи в subtitleCopy, поэтому чистим перед рендером.
function stripUnsupportedGlyphs(text: string): string {
  // Unicode property escapes: убираем emoji + pictographic + variation selectors
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '') // regional indicators
    .replace(/[\uFE0E\uFE0F]/g, '')          // variation selectors
    .replace(/[\u200D]/g, '')                // zero-width joiner
    .replace(/\s{2,}/g, ' ')                 // схлопываем двойные пробелы после очистки
    .trim()
}

export function escapeDrawtext(text: string): string {
  // Внутри `text='...'` литералами идут не все символы: запятая проходит, а
  // двоеточие обрывает строку, и парсер начинает читать остаток как имя опции
  // ("No option name near ' салаты,:fontfile='"). Проверено на ffmpeg в
  // контейнере: `,` — можно, `:` — только экранированным.
  // Одинарные кавычки заменяем на типографские, чтобы не закрывать строку.
  // Backslash дублируем — он сам по себе escape character.
  return stripUnsupportedGlyphs(text)
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%")
}

/**
 * Перенос текста на строки. Дефолт - по словам (4 на строку), потому что character-based
 * перенос даёт строки разной длины при разном размере шрифта и текст часто вылезал
 * за safe-zone. Word-based стабильнее: видно "ровно 4 слова на строку" независимо
 * от длины слов и размера шрифта. Fallback на chars - для legacy совместимости.
 */
function wrapText(text: string, limit: number, mode: 'words' | 'chars' = 'words'): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return []
  const lines: string[] = []

  if (mode === 'words') {
    const maxWords = Math.max(1, limit)
    for (let i = 0; i < words.length; i += maxWords) {
      lines.push(words.slice(i, i + maxWords).join(' '))
    }
    return lines
  }

  // chars mode — старое поведение
  let current = ""
  for (const word of words) {
    if (current && (current.length + 1 + word.length) > limit) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Генерирует drawtext filter строки для одного блока текста.
 * Поддерживает enable-window (start/end time) для per-scene timing.
 */
function buildDrawtextFilters(
  text: string,
  style: DrawtextStyle,
  format: "portrait" | "landscape",
  role: "top" | "bottom" | "scene",
  opts?: {
    casing?: string
    enableStart?: number
    enableEnd?: number
  },
): string[] {
  if (!text) return []

  const isPortrait = format === "portrait"
  let processedText = text
  if (opts?.casing === "uppercase") processedText = text.toUpperCase()

  const lines = wrapText(processedText, style.wrapLimit, style.wrapMode)
  const lineHeight = Math.round(style.fontSize * 1.35)
  const filters: string[] = []

  // Time window for per-scene subtitles
  const enableExpr = (opts?.enableStart !== undefined && opts?.enableEnd !== undefined)
    ? `:enable='between(t,${opts.enableStart.toFixed(2)},${opts.enableEnd.toFixed(2)})'`
    : ""

  // Box styling
  const boxExpr = style.boxEnabled
    ? `:box=1:boxcolor=${style.boxColor}:boxborderw=14`
    : ""

  // Drop shadow — ещё один слой отрыва текста от фона, особенно важно на переменных
  // сценах где цвет фона неизвестен до генерации.
  const shadowExpr = style.shadowEnabled
    ? `:shadowcolor=${style.shadowColor}:shadowx=${style.shadowOffset}:shadowy=${style.shadowOffset}`
    : ""

  // Шрифт с поддержкой кириллицы. Без fontfile ffmpeg использует встроенный
  // fallback, который не покрывает RU-глифы — текст ломается в квадраты.
  const fontPath = resolveSubtitleFont()
  const fontExpr = fontPath ? `:fontfile=${fontPath.replace(/:/g, '\\\\:')}` : ''

  if (role === "top" || style.position === "top") {
    // Safe zone: avoid notch area on mobile
    const startY = isPortrait ? 120 : 50
    for (let i = 0; i < lines.length; i++) {
      const escaped = escapeDrawtext(lines[i]!)
      if (!escaped) continue
      const y = startY + i * lineHeight
      filters.push(
        `drawtext=text='${escaped}'${fontExpr}:fontsize=${style.fontSize}:fontcolor=${style.fontColor}:borderw=${style.borderWidth}:bordercolor=${style.borderColor}:x=(w-text_w)/2:y=${y}${shadowExpr}${boxExpr}${enableExpr}`,
      )
    }
  } else if (role === "bottom" || style.position === "bottom") {
    // Safe zone: avoid home indicator / navigation bar
    const baseY = isPortrait ? 200 : 100
    for (let i = 0; i < lines.length; i++) {
      const escaped = escapeDrawtext(lines[i]!)
      if (!escaped) continue
      const yOffset = baseY + (lines.length - 1 - i) * lineHeight
      filters.push(
        `drawtext=text='${escaped}'${fontExpr}:fontsize=${style.fontSize}:fontcolor=${style.fontColor}:borderw=${style.borderWidth}:bordercolor=${style.borderColor}:x=(w-text_w)/2:y=h-${yOffset}${shadowExpr}${boxExpr}${enableExpr}`,
      )
    }
  } else {
    // Center placement (anti-occlusion: slightly above true center)
    const centerOffset = isPortrait ? -50 : -30
    const totalHeight = lines.length * lineHeight
    const startY = `(h/2)-(${Math.round(totalHeight / 2)})+(${centerOffset})`
    for (let i = 0; i < lines.length; i++) {
      const escaped = escapeDrawtext(lines[i]!)
      if (!escaped) continue
      filters.push(
        `drawtext=text='${escaped}'${fontExpr}:fontsize=${style.fontSize}:fontcolor=${style.fontColor}:borderw=${style.borderWidth}:bordercolor=${style.borderColor}:x=(w-text_w)/2:y=${startY}+${i * lineHeight}${shadowExpr}${boxExpr}${enableExpr}`,
      )
    }
  }

  return filters
}

/**
 * Проверяет наличие audio stream через ffprobe. Нужно перед нормализацией — клипы
 * без аудио (например, Kling без generate_audio) требуют silent track, иначе concat
 * из микса "видео-с-аудио" + "видео-без-аудио" даёт рассинхрон и битые сегменты.
 */
async function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err || !metadata?.streams) {
        resolve(false)
        return
      }
      resolve(metadata.streams.some((s) => s.codec_type === "audio"))
    })
  })
}

/**
 * Нормализует клип в стандартный формат, безопасный для concat demuxer:
 *   H.264 high@4.1 yuv420p, 30fps, фиксированный timebase, scale+pad до целевого
 *   resolution, AAC 44.1k stereo, PTS reset через setpts/asetpts.
 *
 * Concat demuxer склеивает packets без декодирования и при разных fps/timebase/profile/
 * наличии-аудио между клипами даёт "застывшие кадры" — декодер ждёт keyframe или
 * совместимые timestamps, и в результате до 10 секунд фриза в финальном MP4.
 * Pre-encode в единый формат устраняет несовместимости на уровне packet stream.
 *
 * Кэшируется по mtime: если norm-файл существует и старше input — переиспользуется.
 * Это спасает rerun assembly от повторного re-encode (тяжёлая операция).
 */
async function normalizeClip(
  inputPath: string,
  outputPath: string,
  format: "portrait" | "landscape",
  /** Индекс сцены для выбора плана. null — смена плана выключена. */
  sceneIndex: number | null = null,
): Promise<void> {
  try {
    const [inputStat, outputStat] = await Promise.all([stat(inputPath), stat(outputPath)])
    if (outputStat.mtimeMs >= inputStat.mtimeMs && outputStat.size > 0) {
      return
    }
  } catch {
    // outputPath не существует — нормально, пойдём re-encode
  }

  const target = format === "portrait" ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 }
  const audioPresent = await hasAudioStream(inputPath)

  // Длительность нужна, чтобы движение прошло ровно за сцену. Неизмеримый файл
  // не повод отказываться от кадрирования — план просто станет статичным.
  const shotDurationSec = sceneIndex === null ? null : await probeMediaDuration(inputPath)
  const shotFilter = sceneIndex === null
    ? null
    : buildShotVariationFilter(
      shotDurationSec === null ? "static_tight" : pickShotVariationPlan(sceneIndex),
      target,
      shotDurationSec ?? 1,
    )

  return new Promise((resolve, reject) => {
    const stderrTail: string[] = []
    const cmd = ffmpeg().input(inputPath)

    // Смена плана идёт ПОСЛЕ приведения к формату: движение считается от
    // готового кадра 1080x1920, а не от произвольного размера исходника.
    const videoFilter = `[0:v]scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease,pad=${target.w}:${target.h}:-1:-1:color=black${shotFilter ? `,${shotFilter}` : ""},fps=30,setpts=PTS-STARTPTS,format=yuv420p[v]`
    // Silent track — через `anullsrc` КАК FILTER SOURCE внутри filter_complex (часть libavfilter,
    // всегда доступен). Не путать с `-f lavfi -i anullsrc=...` — это input device demuxer,
    // и fluent-ffmpeg криво раскладывает inputOptions по второму input → "Input format lavfi
    // is not available". Filter source решает обе проблемы одним графом без второго input.
    const audioFilter = audioPresent
      ? `[0:a]aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo,asetpts=PTS-STARTPTS[a]`
      : `anullsrc=channel_layout=stereo:sample_rate=44100,asetpts=PTS-STARTPTS[a]`

    cmd
      .complexFilter([videoFilter, audioFilter])
      .outputOptions([
        "-map", "[v]",
        "-map", "[a]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-profile:v", "high",
        "-level", "4.1",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-video_track_timescale", "30000",
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-shortest",
        "-y",
      ])
      .output(outputPath)
      .on("stderr", (line: string) => {
        stderrTail.push(line)
        if (stderrTail.length > 30) stderrTail.shift()
      })
      .on("end", () => resolve())
      .on("error", (err) => {
        const tail = stderrTail.slice(-10).join("\n")
        reject(new Error(
          `Не удалось нормализовать клип ${inputPath}: ${err.message}`
          + (tail ? `\n--- stderr ---\n${tail}` : ""),
        ))
      })
      .run()
  })
}

/**
 * Прогоняет клипы через normalize последовательно и возвращает массив новых путей.
 * Имя файла: `<original_basename>_norm.mp4` рядом с исходником.
 *
 * Последовательно (а не Promise.all) намеренно — параллельный re-encode 5+ файлов
 * через libx264 быстро упирается в CPU и съедает RAM, на проде это привело бы к OOM.
 */
export async function normalizeClipsForConcat(
  clips: string[],
  format: "portrait" | "landscape",
): Promise<string[]> {
  // Смена плана внутри сцены: кадрирование и медленное движение по времени.
  // Выключается `SHOT_VARIATION_ENABLED=false` — тогда клипы нормализуются как
  // раньше, кадр в кадр с исходником.
  const shotVariation = process.env.SHOT_VARIATION_ENABLED !== "false"
  const normalized: string[] = []
  for (const [index, clip] of clips.entries()) {
    const normPath = clip.replace(/\.mp4$/i, "_norm.mp4")
    await normalizeClip(clip, normPath, format, shotVariation ? index : null)
    normalized.push(normPath)
  }
  return normalized
}

/**
 * Длительность, которой подменяется неизмеримый клип в probeClipDurations.
 * Только для сборки: таймлайн субтитров и сведение озвучки обязаны построиться
 * даже по битому файлу, иначе ролик не соберётся вообще.
 */
const FALLBACK_CLIP_DURATION_SEC = 5

/**
 * Строгий замер длительности медиафайла.
 *
 * Возвращает null, если ffprobe недоступен, файла нет, он битый или в метаданных
 * нет вменяемой длительности. Этим и отличается от probeClipDurations: там любая
 * неудача молча превращается в 5 секунд, и всякая проверка вида «уложился ли
 * источник в диапазон модели» вырождается в константу — битый файл всегда
 * «5 с, всё ок». Там, где по длительности принимается РЕШЕНИЕ (пускать сцену в
 * lip-sync или нет), нужен именно этот замер.
 */
export async function probeMediaDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      // err игнорировать нельзя: без файла/ffprobe metadata приходит пустой, и
      // «|| 5» превращал ошибку в правдоподобное число.
      if (err) {
        resolve(null)
        return
      }
      const duration = metadata?.format?.duration
      resolve(typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null)
    })
  })
}

/**
 * Probes clip durations using ffprobe to build accurate timeline.
 *
 * Массивная семантика намеренно осталась «с дефолтом»: потребители (таймлайн
 * субтитров, реконсиляция озвучки) складывают длительности подряд и не умеют
 * работать с дырами. Для решений по конкретному файлу используйте probeMediaDuration.
 */
export async function probeClipDurations(clips: string[]): Promise<number[]> {
  const durations: number[] = []
  for (const clip of clips) {
    durations.push(await probeMediaDuration(clip) ?? FALLBACK_CLIP_DURATION_SEC)
  }
  return durations
}

/**
 * Adjust audio tempo (speed) without pitch change using FFmpeg atempo.
 * Writes result to newPath. Returns probed duration.
 * atempo supports 0.5-2.0 range — we clamp and chain if needed.
 */
export async function adjustAudioTempo(
  inputPath: string,
  outputPath: string,
  speed: number,
): Promise<{ outputPath: string; durationSec: number }> {
  const clamped = Math.max(0.5, Math.min(2.0, speed))
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(`atempo=${clamped.toFixed(3)}`)
      .outputOptions(['-c:a', 'libmp3lame', '-b:a', '192k', '-y'])
      .output(outputPath)
      .on('end', () => {
        ffmpeg.ffprobe(outputPath, (err, metadata) => {
          const duration = metadata?.format?.duration ?? 0
          resolve({ outputPath, durationSec: Math.round(duration * 100) / 100 })
        })
      })
      .on('error', (err) => reject(new Error(`atempo failed: ${err.message}`)))
      .run()
  })
}

/**
 * Trim audio file to exact length (seconds) with short fade-out at the cut.
 */
export async function trimAudio(
  inputPath: string,
  outputPath: string,
  targetDurationSec: number,
): Promise<{ outputPath: string; durationSec: number }> {
  return new Promise((resolve, reject) => {
    const fadeStart = Math.max(0, targetDurationSec - 0.25)
    ffmpeg(inputPath)
      .audioFilters([
        `atrim=0:${targetDurationSec.toFixed(3)}`,
        `afade=t=out:st=${fadeStart.toFixed(3)}:d=0.25`,
        'asetpts=N/SR/TB',
      ])
      .outputOptions(['-c:a', 'libmp3lame', '-b:a', '192k', '-y'])
      .output(outputPath)
      .on('end', () => {
        ffmpeg.ffprobe(outputPath, (err, metadata) => {
          const duration = metadata?.format?.duration ?? targetDurationSec
          resolve({ outputPath, durationSec: Math.round(duration * 100) / 100 })
        })
      })
      .on('error', (err) => reject(new Error(`trimAudio failed: ${err.message}`)))
      .run()
  })
}

/** Предел удлинения сцены: не больше +50% исходной длины и не больше 5 секунд. */
export const MAX_CLIP_EXTEND_RATIO = 0.5
export const MAX_CLIP_EXTEND_SEC = 5

/**
 * Считает, на сколько можно удлинить клип под озвучку (политика extend_scene).
 * Чистая функция — вся политика лимитов в одном месте, её видно в тестах.
 *
 * Возвращает allowed=false, если удлинение вышло за разумный предел: caller
 * деградирует в ускорение/обрезку, а не растягивает последний кадр на полминуты.
 */
export function planClipExtension(opts: {
  clipDurationSec: number
  voiceoverDurationSec: number
  /** Тот же зазор, что использует reconciliation (обычно 0.1s). */
  gapSec?: number
}): { neededSec: number; allowed: boolean; limitSec: number } {
  const gap = opts.gapSec ?? 0.1
  // Нужная длина клипа = озвучка + зазор, чтобы maxAllowed (clip - gap) её вместил.
  const needed = Math.max(0, opts.voiceoverDurationSec + gap - opts.clipDurationSec)
  const limit = Math.min(opts.clipDurationSec * MAX_CLIP_EXTEND_RATIO, MAX_CLIP_EXTEND_SEC)
  return {
    neededSec: Math.round(needed * 100) / 100,
    allowed: needed > 0 && needed <= limit,
    limitSec: Math.round(limit * 100) / 100,
  }
}

/**
 * Удлиняет видеоклип, удерживая последний кадр (tpad=stop_mode=clone).
 * Аудио-дорожка клипа добивается тишиной (apad), иначе `-shortest` в последующей
 * нормализации отрезал бы дорисованный хвост обратно.
 *
 * Используется политикой voiceoverReconciliation='extend_scene': сцена растягивается
 * под озвучку вместо того, чтобы резать/ускорять голос.
 */
export async function extendVideoClip(
  inputPath: string,
  outputPath: string,
  extraSec: number,
): Promise<{ outputPath: string; durationSec: number }> {
  const extra = Math.max(0.1, Math.round(extraSec * 100) / 100)
  const audioPresent = await hasAudioStream(inputPath)

  return new Promise((resolve, reject) => {
    const stderrTail: string[] = []
    const filters = [`[0:v]tpad=stop_mode=clone:stop_duration=${extra.toFixed(2)}[v]`]
    const outputOpts = [
      "-map", "[v]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-y",
    ]
    if (audioPresent) {
      filters.push(`[0:a]apad=pad_dur=${extra.toFixed(2)}[a]`)
      outputOpts.push("-map", "[a]", "-c:a", "aac", "-b:a", "128k")
    }

    ffmpeg()
      .input(inputPath)
      .complexFilter(filters)
      .outputOptions(outputOpts)
      .output(outputPath)
      .on("stderr", (line: string) => {
        stderrTail.push(line)
        if (stderrTail.length > 20) stderrTail.shift()
      })
      .on("end", () => {
        ffmpeg.ffprobe(outputPath, (_err, metadata) => {
          const duration = metadata?.format?.duration ?? 0
          resolve({ outputPath, durationSec: Math.round(duration * 100) / 100 })
        })
      })
      .on("error", (err) => {
        const tail = stderrTail.slice(-10).join("\n")
        reject(new Error(
          `Не удалось удлинить клип ${inputPath} на ${extra}s: ${err.message}`
          + (tail ? `\n--- stderr ---\n${tail}` : ""),
        ))
      })
      .run()
  })
}

/**
 * Собирает финальное видео через FFmpeg.
 * Шаги: concat clips -> scale -> drawtext subtitles -> audio mix -> MP4 (H.264 + AAC)
 *
 * Story-driven mode: per-scene subtitles with accurate timing via ffprobe.
 * Each clip gets its subtitle displayed only during that clip's time window.
 * Legacy mode: topText (hook) сверху, bottomText (cta) снизу — для всех клипов одинаково.
 *
 * Audio mix lanes:
 *   [0:a] — audio из concatenated clips (clip-native audio, например Kling generate_audio=true)
 *   [1:a] — music track (optional)
 *   [2:a] — voiceover track (optional, pre-mixed per-scene)
 * Громкости:
 *   clips: 1.0 если voiceover выключен, иначе clipVolumeWithVoiceover (по умолчанию 0.3, чтобы
 *     nativ audio Kling не перекрикивал озвучку)
 *   music: musicVolume (по умолчанию 0.3) или musicVolumeWithVoiceover (по умолчанию 0.12) когда voiceover включён
 *   voiceover: 1.0 — главный lane
 */
export async function assembleVideo(options: AssembleOptions): Promise<AssembleResult> {
  const {
    clips, topText, bottomText, musicPath, format, outputPath, sceneSubtitles, subtitleStyle,
    subtitlePreset = DEFAULT_SUBTITLE_PRESET,
    voiceoverPath,
    musicVolume = 0.3,
    musicVolumeWithVoiceover = 0.12,
    clipVolumeWithVoiceover = 0.3,
    voiceoverIntervals,
  } = options

  await ensureDir(dirname(outputPath))

  // Pre-normalize клипов: единый кодек/fps/timebase/audio спасают concat demuxer от
  // "застывших кадров" на стыке клипов с разными параметрами. Кэшируется по mtime.
  const normalizedClips = await normalizeClipsForConcat(clips, format)

  // Создать concat list файл
  const concatListPath = outputPath.replace(/\.mp4$/, "_concat.txt")
  const concatContent = normalizedClips.map((c) => `file '${c}'`).join("\n")
  await writeFile(concatListPath, concatContent, "utf-8")

  const casing = subtitleStyle?.typography?.casing

  // Build subtitle filters
  let subtitleFilters: string[] = []

  // ── ASS render ветка: пробуем сначала, если preset.renderer === 'ass' ─────────
  // При успехе — пропускаем drawtext-блок целиком. При ошибке — фолбэк на drawtext
  // с preset='classic' (стандартный fast-path), чтобы видео всё равно собралось.
  const presetMeta = getPresetByKey(options.subtitlePreset)
  const wantAss = presetMeta.renderer === 'ass'
  const hasAnySubtitles = (sceneSubtitles && sceneSubtitles.length > 0)
    || !!(topText || bottomText)

  if (wantAss && hasAnySubtitles) {
    const assSegments = await buildAssSegments({
      clips: normalizedClips,
      sceneSubtitles,
      topText,
      bottomText,
      keywordHints: options.keywordHints,
      maxChars: maxCharsForWidth(
        format === 'portrait' ? 1080 : 1920,
        format === 'portrait' ? presetMeta.fontSizePortrait : presetMeta.fontSizeLandscape,
        format === 'portrait' ? 60 : 100,
      ),
    })
    if (assSegments.length > 0) {
      // videoId используется только для имени директории — выдёргиваем из outputPath.
      // outputPath имеет формат `{getVideosDir()}/{videoId}.mp4`.
      const videoIdFromPath = parseVideoIdFromOutputPath(outputPath)
      const ass = await tryRenderAssFilter({
        videoId: videoIdFromPath,
        format,
        preset: presetMeta,
        styleOverrides: normalizeSubtitleStyle(subtitleStyle ?? null),
        segments: assSegments,
      })
      if (ass) {
        subtitleFilters = [ass.filterStr]
      }
    }
  }

  // Если ASS-ветка не сработала ИЛИ preset.renderer === 'drawtext' → собираем drawtext.
  if (subtitleFilters.length === 0 && sceneSubtitles && sceneSubtitles.length > 0) {
    // Story-driven mode: окно каждого субтитра берём у КЛИПА ЕГО СЦЕНЫ (sceneIndex),
    // а не по позиции в массиве субтитров — иначе сцена без текста уводила весь хвост.
    const clipDurations = await probeClipDurations(normalizedClips)
    const windows = buildSubtitleTimeline(clipDurations, sceneSubtitles)

    for (const window of windows) {
      const position = window.placement?.position || 'bottom'
      const style = resolveSubtitleStyle(format, subtitleStyle, position, subtitlePreset)
      const role = position === 'top' ? 'top' : position === 'center' ? 'scene' : 'bottom'

      // Окно показа уже посчитано (buildSubtitleTimeline, зазор в конце учтён),
      // но реплика сцены не должна висеть одним блоком на девять секунд: внутри
      // окна режем её на короткие фразы, чтобы субтитр шёл вслед за речью и не
      // вылезал по ширине кадра.
      const chunks = chunkSceneSpeech(window.text, window.startSec, window.endSec, {
        maxChars: maxCharsForWidth(
          format === 'portrait' ? 1080 : 1920,
          style.fontSize,
          format === 'portrait' ? 60 : 100,
        ),
      })

      for (const chunk of chunks) {
        subtitleFilters.push(...buildDrawtextFilters(chunk.text, style, format, role, {
          casing,
          enableStart: chunk.startSec,
          enableEnd: chunk.endSec,
        }))
      }
    }
  } else if (subtitleFilters.length === 0) {
    // Legacy mode: topText + bottomText с опциональным style profile
    if (topText) {
      const style = resolveSubtitleStyle(format, subtitleStyle, "top", subtitlePreset)
      subtitleFilters.push(...buildDrawtextFilters(topText, style, format, "top", { casing }))
    }
    if (bottomText) {
      const style = resolveSubtitleStyle(format, subtitleStyle, "bottom", subtitlePreset)
      subtitleFilters.push(...buildDrawtextFilters(bottomText, style, format, "bottom", { casing }))
    }
  }

  // Перед ffmpeg-input: проверяем что путь не просто строка, а реальный файл
  // на диске с ненулевым размером. Раньше при упавшем downloadFile (Mubert)
  // или прерванном TTS-mix путь оставался в БД, ffmpeg input открывал пустой
  // файл и видео собиралось без звука без диагностики.
  const musicUsable = await isUsableAudioFile(musicPath)
  const voiceoverUsable = await isUsableAudioFile(voiceoverPath)

  if (musicPath && !musicUsable) {
    console.warn(`[render] musicPath указан, но файл недоступен/пустой: ${musicPath} — собираем без музыки`)
  }
  if (voiceoverPath && !voiceoverUsable) {
    console.warn(`[render] voiceoverPath указан, но файл недоступен/пустой: ${voiceoverPath} — собираем без озвучки`)
  }

  const hasMusic = musicUsable
  const hasVoiceover = voiceoverUsable

  // Замер громкости озвучки до сборки. Двухпроходный loudnorm точнее
  // однопроходного и не «дышит»: он сдвигает усиление ровно, а не подгоняет
  // на ходу. Отказ замера — не потерянная сборка: второй проход уйдёт в
  // однопроходный режим (см. video-tools/loudness.ts).
  const voiceoverLoudness = hasVoiceover && voiceoverPath
    ? await measureLoudness(voiceoverPath)
    : null
  if (hasVoiceover) {
    console.log(`[render] громкость озвучки: ${voiceoverLoudness ? `замерена (${voiceoverLoudness.inputI} LUFS)` : "замер не удался, однопроходный режим"}`)
  }

  console.log(
    `[render] audio mix: music=${hasMusic ? 'on' : 'off'}, voiceover=${hasVoiceover ? 'on' : 'off'}, clipNativeAudio=normalized`,
  )

  return new Promise<AssembleResult>((resolve, reject) => {
    let command = ffmpeg()
      .input(concatListPath)
      .inputOptions(["-f", "concat", "-safe", "0"])

    // scale/pad/fps уже применены при нормализации клипов — здесь только subtitle-фильтры.
    const filters: string[] = []
    if (subtitleFilters.length > 0) {
      filters.push(...subtitleFilters)
    }

    const outputOpts = [
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "23",
      "-movflags", "+faststart",
      "-y",
    ]

    // null-фильтр — passthrough, обязателен для filter_complex когда subtitle-фильтров нет:
    // пустая строка `[0:v][vout]` ломает filtergraph parser.
    const videoFilterStr = filters.length > 0 ? filters.join(",") : "null"

    if (hasMusic || hasVoiceover) {
      // Порядок входов: [0]=concat clips (video+audio), [1]=music (optional), [2]=voiceover (optional)
      let musicInputIdx: number | null = null
      let voiceoverInputIdx: number | null = null

      if (hasMusic) {
        command = command.input(musicPath!)
        musicInputIdx = 1
      }
      if (hasVoiceover) {
        command = command.input(voiceoverPath!)
        voiceoverInputIdx = musicInputIdx !== null ? 2 : 1
      }

      const audioFilters: string[] = []
      const mixLabels: string[] = []

      // Clip-native audio lane. При закадровом голосе приглушаем — но точечно,
      // если известно, на каких отрезках он звучит.
      if (hasVoiceover) {
        const duckWindows = (voiceoverIntervals ?? [])
          .filter(i => Number.isFinite(i.startSec) && Number.isFinite(i.endSec) && i.endSec > i.startSec)
          .map(i => `between(t,${i.startSec.toFixed(2)},${i.endSec.toFixed(2)})`)
        audioFilters.push(duckWindows.length > 0
          ? `[0:a]volume=${clipVolumeWithVoiceover.toFixed(3)}:enable='${duckWindows.join('+')}'[va]`
          : `[0:a]volume=${clipVolumeWithVoiceover.toFixed(3)}[va]`)
      } else {
        audioFilters.push(`[0:a]volume=1.000[va]`)
      }
      mixLabels.push('[va]')

      // Music lane (с ducking если есть voiceover)
      if (musicInputIdx !== null) {
        const musicLaneVolume = hasVoiceover ? musicVolumeWithVoiceover : musicVolume
        audioFilters.push(`[${musicInputIdx}:a]volume=${musicLaneVolume.toFixed(3)}[ma]`)
        mixLabels.push('[ma]')
      }

      // Voiceover lane (главный голос).
      //
      // Громкость приводится к цели, а не берётся «как отдала модель»: MiniMax
      // отдаёт −25.8 LUFS, Fish −17.4, разброс 8 LU. Без этого смена модели
      // озвучки уводила громкость всей партии (см. video-tools/loudness.ts).
      if (voiceoverInputIdx !== null) {
        audioFilters.push(`[${voiceoverInputIdx}:a]${buildLoudnormApplyFilter(voiceoverLoudness)}[vo]`)
        mixLabels.push('[vo]')
      }

      // Лимитер после сведения: пики дорожек складываются, и без потолка микс
      // клиппится там, где голос совпал с акцентом музыки.
      const amixLine = `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0,`
        + `alimiter=limit=${LIMITER_CEILING}[aout]`

      const complexFilterStr = [
        `[0:v]${videoFilterStr}[vout]`,
        ...audioFilters,
        amixLine,
      ].join(';')

      outputOpts.push(
        '-filter_complex', complexFilterStr,
        '-map', '[vout]',
        '-map', '[aout]',
        '-c:a', 'aac',
        '-b:a', '192k',
      )
    } else {
      // Без музыки и без voiceover — videoFilters для видео, аудио из клипов как есть.
      // filters может быть пустым (если нет субтитров) — fluent-ffmpeg тогда не добавит -vf,
      // и поток клонируется без re-encode. Поскольку клипы нормализованы — это валидно.
      if (filters.length > 0) {
        command = command.videoFilters(filters)
      }
      outputOpts.push(
        '-c:a', 'aac',
        '-b:a', '128k',
      )
    }

    // Кольцевой буфер последних строк stderr — без него FFmpeg ошибки
    // приходят как "exit code 234, Invalid argument" без указания КАКОГО.
    const stderrTail: string[] = []
    let lastStartCmd = ''

    command
      .outputOptions(outputOpts)
      .output(outputPath)
      .on('start', (cmd) => {
        lastStartCmd = cmd
      })
      .on('stderr', (line: string) => {
        stderrTail.push(line)
        if (stderrTail.length > 40) stderrTail.shift()
      })
      .on("end", async () => {
        // Удалить временные файлы
        try { await unlink(concatListPath) } catch { /* ignore */ }

        // Получить длительность
        ffmpeg.ffprobe(outputPath, (err, metadata) => {
          const duration = Math.round(metadata?.format?.duration || 0)
          resolve({ filePath: outputPath, duration })
        })
      })
      .on("error", (err) => {
        const tail = stderrTail.slice(-12).join('\n')
        const cmdHead = lastStartCmd.length > 800 ? lastStartCmd.slice(0, 800) + '…' : lastStartCmd
        reject(new Error(
          `FFmpeg ошибка: ${err.message}`
          + (tail ? `\n--- stderr ---\n${tail}` : '')
          + (cmdHead ? `\n--- cmd ---\n${cmdHead}` : ''),
        ))
      })
      .run()
  })
}

/**
 * Собирает массив AssSegmentInput из либо story-driven sceneSubtitles, либо legacy
 * topText/bottomText. Использует ffprobe для расчёта реальных временных окон.
 */
async function buildAssSegments(opts: {
  clips: string[]
  sceneSubtitles?: SceneSubtitleInput[]
  topText: string
  bottomText: string
  keywordHints?: Array<{ order: number; keywords: Array<{ word: string; weight: number }> }>
  /** Потолок длины фразы под ширину кадра и кегль выбранного пресета. */
  maxChars?: number
}): Promise<Array<import('./subtitles/ass-builder/dialogue').AssSegmentInput>> {
  const segs: Array<import('./subtitles/ass-builder/dialogue').AssSegmentInput> = []

  if (opts.sceneSubtitles && opts.sceneSubtitles.length > 0) {
    const clipDurations = opts.clips.length > 0 ? await probeClipDurations(opts.clips) : []
    // Тот же расчёт окон, что и в drawtext-ветке — выравнивание строго по sceneIndex.
    const windows = buildSubtitleTimeline(clipDurations, opts.sceneSubtitles)

    // keywordHints нумеруются как sceneIndex + 1 (1-based, так их видит AI-агент).
    const aiMap = new Map<number, Array<{ word: string; weight: number }>>()
    if (opts.keywordHints) {
      for (const h of opts.keywordHints) aiMap.set(h.order, h.keywords)
    }

    for (const window of windows) {
      // Та же нарезка, что и в drawtext-ветке: фраза за фразой вслед за речью.
      for (const chunk of chunkSceneSpeech(window.text, window.startSec, window.endSec, { maxChars: opts.maxChars })) {
        segs.push({
          startSec: chunk.startSec,
          endSec: chunk.endSec,
          text: chunk.text,
          placement: window.placement,
          aiKeywords: aiMap.get(window.sceneIndex + 1),
        })
      }
    }
    return segs
  }

  // Legacy mode: topText (top) + bottomText (bottom) на всю длительность видео.
  const totalDuration = opts.clips.length > 0
    ? (await probeClipDurations(opts.clips)).reduce((a, b) => a + b, 0)
    : 10
  if (opts.topText) {
    segs.push({
      startSec: 0,
      endSec: totalDuration,
      text: opts.topText,
      placement: { position: 'top', alignment: 'center', avoidZones: [] },
    })
  }
  if (opts.bottomText) {
    segs.push({
      startSec: 0,
      endSec: totalDuration,
      text: opts.bottomText,
      placement: { position: 'bottom', alignment: 'center', avoidZones: [] },
    })
  }
  return segs
}

/**
 * outputPath имеет формат `<videosDir>/<videoId>.mp4`. Достаём ID для именования
 * директории ASS-файлов. При нестандартном пути возвращаем 0 — generateAssFile
 * положит файл в storage/uploads/subtitles/0/.
 */
function parseVideoIdFromOutputPath(outputPath: string): number {
  const match = outputPath.match(/(\d+)\.mp4$/)
  if (!match) return 0
  const n = Number(match[1])
  return Number.isFinite(n) ? n : 0
}

/**
 * Безопасное удаление файла (игнорирует отсутствие).
 */
export async function safeUnlink(filePath: string): Promise<void> {
  try {
    if (await fileExists(filePath)) {
      await unlink(filePath)
    }
  } catch {
    // Не критично если файл не удалён
  }
}
