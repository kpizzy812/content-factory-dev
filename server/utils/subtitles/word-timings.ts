/**
 * Word-timing helpers для karaoke-пресетов.
 *
 * Реальные word-level тайминги ТЕПЕРЬ используются: на маршруте «монтаж от
 * звука» их достаёт `wordsForChunk` (`aligned-words.ts`) из выровненного
 * транскрипта (`transcription/align.ts`) и передаёт в `AssSegmentInput.words`
 * (`ass-builder/dialogue.ts`). Здесь остаётся FALLBACK для сцен без
 * выравнивания: распределяем длительность сегмента равномерно по словам с
 * минимумом 200 мс на слово (иначе глаз не успевает прочесть).
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
