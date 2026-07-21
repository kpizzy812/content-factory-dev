/**
 * Word-timing helpers для karaoke-пресетов.
 *
 * Whisper word-level timings ещё не используются в pipeline (TTS возвращает только полную
 * длительность строки). MVP-fallback: распределяем длительность сегмента равномерно по
 * словам с минимумом 200 мс на слово (иначе глаз не успевает прочесть).
 */

export interface EstimatedWord {
  text: string
  startSec: number
  endSec: number
}

/** Минимум читаемости по research'у — 200 мс на слово. */
const MIN_WORD_DURATION_SEC = 0.2

/**
 * Распределяет [startSec..endSec] равномерно по словам text. Слова получают одинаковую
 * длительность. Если итоговая на слово меньше MIN_WORD_DURATION_SEC — увеличиваем общий
 * блок чтобы каждое слово получило минимум (за счёт overflow за endSec — caller проверит).
 */
export function estimateWordTimings(
  text: string,
  startSec: number,
  endSec: number,
): EstimatedWord[] {
  const cleanedWords = splitWordsForTiming(text)
  if (cleanedWords.length === 0) return []

  const totalDur = Math.max(0.1, endSec - startSec)
  const naivePerWord = totalDur / cleanedWords.length
  const perWord = Math.max(naivePerWord, MIN_WORD_DURATION_SEC)

  const words: EstimatedWord[] = []
  for (let i = 0; i < cleanedWords.length; i++) {
    const wordStart = startSec + i * perWord
    const wordEnd = wordStart + perWord
    words.push({
      text: cleanedWords[i]!,
      startSec: wordStart,
      endSec: wordEnd,
    })
  }
  return words
}

/**
 * Разбивает строку на слова, очищая пунктуацию по краям. Сохраняет внутренние апострофы и
 * дефисы — они часть слова. Punktuation, висящая отдельно, выкидывается.
 */
function splitWordsForTiming(text: string): string[] {
  return text
    .split(/\s+/)
    .map(w => w.replace(/^[.,;:!?…«»"'`()\[\]{}]+|[.,;:!?…«»"'`()\[\]{}]+$/g, ''))
    .filter(w => w.length > 0)
}

/**
 * Extension point для Phase 3: парсинг whisper word-level chunks.
 * Сейчас только тип, без реализации — pipeline ещё не передаёт word-level timings.
 */
export interface WhisperWordChunk {
  text: string
  /** [start, end] в секундах */
  timestamp: [number, number]
}

/**
 * Конвертирует whisper word chunks в нашу EstimatedWord-структуру.
 * Для Phase 3, когда pipeline начнёт извлекать word-level timings из транскрипции.
 */
export function parseWhisperWords(chunks: WhisperWordChunk[]): EstimatedWord[] {
  return chunks.map(c => ({
    text: c.text.trim(),
    startSec: c.timestamp[0],
    endSec: c.timestamp[1],
  })).filter(w => w.text.length > 0)
}
