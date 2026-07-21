/**
 * Применение keyword emphasis к словам сегмента.
 *
 * Если AI keyword-detector прислал `{ word, weight }` — оборачиваем соответствующее слово
 * в emphasisTag. Если AI недоступен (paid-apis disabled) — fallback на эвристики:
 * числа, ALL CAPS, словарь высокоэмоциональных слов (free, секрет, никогда, ...).
 *
 * Лимит 2 keyword на сегмент — больше глаз не воспринимает.
 */

import type { FullSubtitlePreset } from '../preset-registry'
import { emphasisTag } from './animation-tags'

export interface WordWithTiming {
  text: string
  startSec: number
  endSec: number
  /** Помечается keyword-detector'ом или эвристикой. */
  isKeyword?: boolean
  keywordWeight?: number
}

const HEURISTIC_KEYWORDS = new Set([
  // RU
  'бесплатно', 'секрет', 'никогда', 'всегда', 'новый', 'новая', 'новое',
  'миллион', 'миллиард', 'тысяч', 'тысячи',
  'впервые', 'эксклюзив', 'мгновенно', 'срочно', 'лучший', 'худший',
  // EN
  'free', 'secret', 'never', 'always', 'new', 'million', 'billion',
  'first', 'exclusive', 'instant', 'best', 'worst', 'amazing', 'shocking', 'proven',
])

const MAX_KEYWORDS_PER_SEGMENT = 2

/**
 * Эвристическая разметка ключевых слов когда AI-detector недоступен или needsAI=false
 * для пресета. Помечает первые MAX_KEYWORDS_PER_SEGMENT слов, попавших под правила.
 */
export function applyHeuristicKeywords(words: WordWithTiming[]): WordWithTiming[] {
  let marked = 0
  return words.map((w) => {
    if (marked >= MAX_KEYWORDS_PER_SEGMENT) return w
    if (w.isKeyword) {
      marked += 1
      return w
    }
    if (matchesHeuristic(w.text)) {
      marked += 1
      return { ...w, isKeyword: true, keywordWeight: 0.7 }
    }
    return w
  })
}

function matchesHeuristic(rawWord: string): boolean {
  const cleaned = rawWord.replace(/[.,;:!?…«»"'`()]/g, '').trim()
  if (cleaned.length === 0) return false
  // Числа и проценты
  if (/^\d+[%$€₽K]?$/.test(cleaned)) return true
  // ALL CAPS (минимум 2 буквы) — кроме коротких односложных аббревиатур типа "RU"/"AI"
  if (cleaned.length >= 3 && /^[A-ZА-Я]+$/.test(cleaned)) return true
  // Словарь
  if (HEURISTIC_KEYWORDS.has(cleaned.toLowerCase())) return true
  return false
}

/**
 * Применяет AI-разметку keywords из subtitle-keyword-agent к словам сегмента. Match по
 * exact word.toLowerCase() — agent гарантирует word — точную копию из text. Лимит 2 keyword.
 */
export function applyAiKeywords(
  words: WordWithTiming[],
  aiKeywords: Array<{ word: string; weight: number }>,
): WordWithTiming[] {
  if (aiKeywords.length === 0) return words

  const aiMap = new Map<string, number>()
  for (const k of aiKeywords) {
    const key = normaliseForMatch(k.word)
    if (!aiMap.has(key)) aiMap.set(key, k.weight)
  }

  let marked = 0
  return words.map((w) => {
    if (marked >= MAX_KEYWORDS_PER_SEGMENT) return w
    const norm = normaliseForMatch(w.text)
    const weight = aiMap.get(norm)
    if (weight !== undefined) {
      marked += 1
      return { ...w, isKeyword: true, keywordWeight: weight }
    }
    return w
  })
}

function normaliseForMatch(s: string): string {
  return s.replace(/[.,;:!?…«»"'`()\[\]{}]/g, '').trim().toLowerCase()
}

/**
 * Возвращает inline-тег для слова (например "{\1c&H...&}"). Пусто если слово не keyword
 * или пресет не поддерживает emphasis.
 */
export function tagForKeywordWord(
  word: WordWithTiming,
  preset: FullSubtitlePreset,
): string {
  if (!word.isKeyword) return ''
  if (preset.emphasis === 'karaoke_sweep') return ''
  const durMs = Math.round(Math.max(0.1, word.endSec - word.startSec) * 1000)
  return emphasisTag(preset.emphasis, preset.accentColor, durMs)
}
