/**
 * Builder Dialogue-строк ASS-файла.
 *
 * Преобразует AssSegmentInput → строки `Dialogue: 0,0:00:00.00,...`. Разделяет логику:
 * - line wrap по wordsPerLine (повторяет логику из render.ts:wrapText, но с поддержкой ASS)
 * - casing (UPPERCASE/sentence/lowercase)
 * - per-word karaoke (\k тег) для karaoke-пресета
 * - inline emphasis (color/scale) для keyword-слов
 * - entrance + effect tags на сегмент
 *
 * Каждый сегмент = одна Dialogue-строка с alignment и MarginV под placement.
 */

import type { FullSubtitlePreset } from '../preset-registry'
import {
  SUBTITLE_WORDS_PER_LINE_DEFAULT,
  SUBTITLE_WORDS_PER_LINE_MAX,
  SUBTITLE_WORDS_PER_LINE_MIN,
  type SubtitlePlacement,
  type SubtitleStyleProfile,
} from '~~/shared/types/story'
import {
  combineSegmentTags,
  effectTag,
  entranceTag,
  karaokeTag,
} from './animation-tags'
import {
  applyAiKeywords,
  applyHeuristicKeywords,
  tagForKeywordWord,
  type WordWithTiming,
} from './keyword-emphasis'
import { estimateWordTimings } from '../word-timings'

export interface AssSegmentInput {
  startSec: number
  endSec: number
  text: string
  placement: SubtitlePlacement
  /** Точные word-timings (whisper). Если не заданы — estimate через estimateWordTimings. */
  words?: Array<{ text: string; startSec: number; endSec: number }>
  /** AI-keywords от subtitle-keyword-agent для этого сегмента (опционально). */
  aiKeywords?: Array<{ word: string; weight: number }>
}

interface BuildOptions {
  preset: FullSubtitlePreset
  styleOverrides: SubtitleStyleProfile
  format: 'portrait' | 'landscape'
}

/**
 * Главная функция модуля. Возвращает массив строк `Dialogue: ...` готовых к
 * конкатенации в [Events] секции ASS-файла.
 */
export function buildDialogueLines(
  segments: AssSegmentInput[],
  opts: BuildOptions,
): string[] {
  const lines: string[] = []
  for (const seg of segments) {
    const line = buildOneDialogueLine(seg, opts)
    if (line) lines.push(line)
  }
  return lines
}

function buildOneDialogueLine(
  seg: AssSegmentInput,
  opts: BuildOptions,
): string | null {
  const { preset, styleOverrides } = opts

  const rawText = applyCasing(seg.text, preset, styleOverrides)
  if (!rawText.trim()) return null

  const wordsPerLine = clampWordsPerLine(styleOverrides.typography?.wordsPerLine)
  const wrappedLines = wrapText(rawText, wordsPerLine)

  // word-timings: для karaoke и для keyword-emphasis. Распределяем равномерно если whisper
  // word-level не предоставлен.
  const baseWords = seg.words?.length
    ? seg.words.map(w => ({ text: w.text, startSec: w.startSec, endSec: w.endSec }))
    : estimateWordTimings(rawText, seg.startSec, seg.endSec)

  // Apply emphasis: AI-keywords если есть, иначе эвристика для пресетов с needsKeywordDetection.
  let timedWords: WordWithTiming[] = baseWords.map(w => ({ ...w }))
  if (seg.aiKeywords && seg.aiKeywords.length > 0) {
    timedWords = applyAiKeywords(timedWords, seg.aiKeywords)
  } else if (preset.needsKeywordDetection) {
    timedWords = applyHeuristicKeywords(timedWords)
  }

  // Сегмент-уровневые теги (entrance + effect + alignment override под placement).
  // alignmentOverrideTag ВАЖНО: \an должен идти ПЕРВЫМ override в строке, поэтому
  // помещаем его в начало списка для combineSegmentTags.
  const segDur = Math.max(0.1, seg.endSec - seg.startSec)
  const segmentTagsStr = combineSegmentTags([
    alignmentOverrideTag(seg.placement),
    entranceTag(preset.entrance, segDur),
    effectTag(preset.effect, preset.accentColor, segDur),
  ])

  // Текст с ASS-разметкой. Для karaoke-пресета каждое слово в \k тег.
  // Для остальных — wrapped lines с \N разделителем + inline emphasis на keyword-словах.
  const text = preset.emphasis === 'karaoke_sweep'
    ? buildKaraokeText(timedWords, wrappedLines, preset)
    : buildEmphasisText(timedWords, wrappedLines, preset)

  const startTs = secToAssTime(seg.startSec)
  const endTs = secToAssTime(seg.endSec)
  const marginVOverride = computeMarginVOverride(seg.placement, opts.format)

  return [
    'Dialogue: 0',
    startTs,
    endTs,
    'Default',
    '',
    '0',
    '0',
    String(marginVOverride),
    '',
    `${segmentTagsStr}${text}`,
  ].join(',')
}

/**
 * Karaoke text: каждое слово получает \k(centiseconds) — libass переключает PrimaryColour
 * на это слово ровно в момент его word.startSec.
 */
function buildKaraokeText(
  words: WordWithTiming[],
  wrappedLines: string[][],
  _preset: FullSubtitlePreset,
): string {
  const allTokens = wrappedLines.flat()
  // Если wrap дал больше токенов чем word-timings — это разница из-за пунктуации; оставляем
  // последние токены без timing (без \k тега).
  const result: string[] = []
  let lineIndex = 0
  let posInLine = 0
  let wordIndex = 0

  for (const line of wrappedLines) {
    if (lineIndex > 0) result.push('\\N')
    posInLine = 0
    for (const token of line) {
      if (posInLine > 0) result.push(' ')
      const timing = words[wordIndex]
      if (timing) {
        const durCs = Math.round((timing.endSec - timing.startSec) * 100)
        result.push(karaokeTag(durCs))
        wordIndex += 1
      }
      result.push(escapeAssText(token))
      posInLine += 1
    }
    lineIndex += 1
  }
  // Если в estimateWordTimings было больше слов чем wrap-токенов — игнорим хвост.
  void allTokens
  return result.join('')
}

/**
 * Обычный (non-karaoke) текст: wrapped lines + inline emphasis-теги на keyword-слова.
 * Для пресетов с emphasis 'color' / 'color_scale'.
 */
function buildEmphasisText(
  words: WordWithTiming[],
  wrappedLines: string[][],
  preset: FullSubtitlePreset,
): string {
  // Маппим wrapped-токены к WordWithTiming по позиции (нумерация совпадает: и wrap, и
  // estimateWordTimings/whisper делят по \s+ и убирают пустые).
  const result: string[] = []
  let wordIndex = 0
  let lineIndex = 0

  for (const line of wrappedLines) {
    if (lineIndex > 0) result.push('\\N')
    let posInLine = 0
    for (const token of line) {
      if (posInLine > 0) result.push(' ')
      const wordMeta = words[wordIndex]
      if (wordMeta) {
        const tag = tagForKeywordWord(wordMeta, preset)
        if (tag) {
          result.push(tag)
          result.push(escapeAssText(token))
          // \r — сброс к Style по умолчанию после keyword-блока.
          result.push('{\\r}')
        } else {
          result.push(escapeAssText(token))
        }
        wordIndex += 1
      } else {
        result.push(escapeAssText(token))
      }
      posInLine += 1
    }
    lineIndex += 1
  }
  return result.join('')
}

/**
 * Wrap текста по wordsPerLine. Возвращает массив массивов токенов (по строкам).
 */
function wrapText(text: string, wordsPerLine: number): string[][] {
  const tokens = text.split(/\s+/).filter(t => t.length > 0)
  if (tokens.length === 0) return []
  const lines: string[][] = []
  for (let i = 0; i < tokens.length; i += wordsPerLine) {
    lines.push(tokens.slice(i, i + wordsPerLine))
  }
  return lines
}

function clampWordsPerLine(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return SUBTITLE_WORDS_PER_LINE_DEFAULT
  return Math.max(SUBTITLE_WORDS_PER_LINE_MIN, Math.min(SUBTITLE_WORDS_PER_LINE_MAX, Math.round(raw)))
}

/**
 * Применяет casing из styleOverrides + force-uppercase из preset (Hormozi/Beast).
 */
function applyCasing(
  text: string,
  preset: FullSubtitlePreset,
  styleOverrides: SubtitleStyleProfile,
): string {
  if (preset.forceUppercase) return text.toUpperCase()
  const casing = styleOverrides.typography?.casing
  switch (casing) {
    case 'uppercase':
      return text.toUpperCase()
    case 'lowercase':
      return text.toLowerCase()
    case 'sentence':
      // Capitalise first letter of first word, остальное оставляем как пришло.
      return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text
    case 'mixed':
    default:
      return text
  }
}

/** Конвертирует секунды в ASS time `H:MM:SS.cc`. */
function secToAssTime(sec: number): string {
  const safe = Math.max(0, sec)
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = Math.floor(safe % 60)
  const cs = Math.floor((safe - Math.floor(safe)) * 100)
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Escape для ASS Dialogue.Text: заменяем фигурные скобки (они означают override-теги),
 * сохраняем русские/латинские буквы как есть. Для нашего use-case достаточно экранировать
 * { } \ потому что мы сами генерируем \N и \k теги и не хотим конфликтов с пользовательским
 * текстом.
 */
function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
}

/**
 * Per-segment alignment override через `{\an...}`. ASS-стандарт: `\an8` = top-center,
 * `\an5` = middle-center, `\an2` = bottom-center (Style default — поэтому для bottom
 * не префиксим, оставляем Style).
 *
 * ВАЖНО: `\an` обязан идти ПЕРВЫМ override-тегом в Dialogue.Text, иначе libass игнорирует
 * последующие позиционные теги (\pos, \move). См. caller — этот тег ставится первым в
 * combineSegmentTags.
 */
function alignmentOverrideTag(placement: SubtitlePlacement): string {
  switch (placement?.position) {
    case 'top':
      return '{\\an8}'
    case 'center':
      return '{\\an5}'
    case 'bottom':
    default:
      return ''
  }
}

/**
 * MarginV override под placement.position.
 * Для `top` (\an8): MarginV = расстояние от ВЕРХА экрана.
 * Для `center` (\an5): MarginV игнорируется libass (центрирование по PlayResY/2).
 * Для `bottom` (Style default \an2): MarginV = расстояние от НИЗА (0 = берём из Style).
 */
function computeMarginVOverride(
  placement: SubtitlePlacement,
  format: 'portrait' | 'landscape',
): number {
  const isPortrait = format === 'portrait'
  switch (placement?.position) {
    case 'top':
      // Стандартный отступ от верха: 180 px portrait, 120 px landscape — соответствует
      // safe-zone выше TikTok caption-bar и YouTube top-overlay.
      return isPortrait ? 180 : 120
    case 'center':
      // \an5 центрирует относительно PlayResY автоматически — MarginV не требуется.
      return 0
    case 'bottom':
    default:
      return 0
  }
}
