/**
 * Нарезка реплики сцены на субтитровые фразы.
 *
 * Раньше вся реплика сцены висела одним блоком на все её девять секунд. Это
 * плохо с двух сторон: зритель читает стену текста вместо того, что звучит
 * сейчас, а длинная строка не влезает в вертикальный кадр по ширине.
 *
 * Здесь реплика режется на короткие фразы, каждая со своим окном времени.
 * Границы выбираются по знакам препинания — фраза не рвётся посередине мысли,
 * если этого можно избежать.
 */

export interface SubtitleChunk {
  text: string
  startSec: number
  endSec: number
}

export interface ChunkOptions {
  /** Потолок длины фразы в символах. Подбирается под ширину кадра. */
  maxChars?: number
  /** Потолок в словах — короткие слова не должны давать «простыню». */
  maxWords?: number
  /** Минимальное время показа: глаз не успевает прочесть быстрее. */
  minChunkSec?: number
}

const DEFAULT_MAX_CHARS = 32
const DEFAULT_MAX_WORDS = 6
const DEFAULT_MIN_CHUNK_SEC = 0.7

/** После этих символов мысль закончена — здесь резать безопаснее всего. */
const HARD_BREAK = /[.!?…]$/
/** После этих — пауза послабее, но тоже уместная граница. */
const SOFT_BREAK = /[,;:—–-]$/

export function chunkSceneSpeech(
  rawText: string,
  startSec: number,
  endSec: number,
  options: ChunkOptions = {},
): SubtitleChunk[] {
  const text = rawText?.trim() ?? ""
  if (!text) return []

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS
  const minChunkSec = options.minChunkSec ?? DEFAULT_MIN_CHUNK_SEC

  const phrases = splitIntoPhrases(text, maxChars, maxWords)
  if (phrases.length === 0) return []

  const windowSec = Math.max(0.1, endSec - startSec)
  // Время делим пропорционально длине: длинную фразу читают дольше короткой.
  const totalChars = phrases.reduce((sum, phrase) => sum + phrase.length, 0)

  // Фраз может оказаться больше, чем помещается по минимальному времени показа.
  // Тогда честнее показать каждую коротко, чем растянуть за пределы сцены.
  const affordableMin = Math.min(minChunkSec, windowSec / phrases.length)

  const chunks: SubtitleChunk[] = []
  let cursor = startSec
  for (let i = 0; i < phrases.length; i++) {
    const phrase = phrases[i]!
    const share = totalChars > 0 ? phrase.length / totalChars : 1 / phrases.length
    const isLast = i === phrases.length - 1
    const duration = isLast
      ? Math.max(affordableMin, endSec - cursor)
      : Math.max(affordableMin, windowSec * share)

    const chunkEnd = isLast ? endSec : Math.min(endSec, cursor + duration)
    if (chunkEnd <= cursor) break

    chunks.push({ text: phrase, startSec: cursor, endSec: chunkEnd })
    cursor = chunkEnd
  }

  return chunks
}

/**
 * Режет текст на фразы, не превышающие лимиты. Границу ищем по знакам
 * препинания: сначала по концу предложения, затем по запятой или тире.
 */
function splitIntoPhrases(text: string, maxChars: number, maxWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const phrases: string[] = []
  let current: string[] = []

  const flush = () => {
    if (current.length > 0) {
      phrases.push(current.join(" "))
      current = []
    }
  }

  for (const word of words) {
    const candidate = [...current, word]
    const candidateLength = candidate.join(" ").length

    // Одно слово длиннее лимита выносим как есть: рвать слово хуже, чем
    // показать его отдельной фразой.
    if (current.length === 0) {
      current = candidate
      if (HARD_BREAK.test(word) || candidateLength >= maxChars) flush()
      continue
    }

    if (candidateLength > maxChars || candidate.length > maxWords) {
      flush()
      current = [word]
      if (HARD_BREAK.test(word)) flush()
      continue
    }

    current = candidate
    // Конец предложения — режем сразу. Слабая пауза — только если фраза уже
    // набрала заметную длину, иначе получится частокол из огрызков.
    if (HARD_BREAK.test(word)) flush()
    else if (SOFT_BREAK.test(word) && candidateLength >= maxChars * 0.6) flush()
  }

  flush()
  return phrases
}

/**
 * Сколько символов помещается в строку по ширине кадра. Ширина глифа берётся
 * долей от кегля — точные метрики шрифта здесь не нужны, нужен потолок, за
 * который текст не вылезет.
 */
export function maxCharsForWidth(
  frameWidth: number,
  fontSize: number,
  sideMargin: number,
  glyphWidthRatio = 0.55,
): number {
  const usable = Math.max(1, frameWidth - sideMargin * 2)
  const glyphWidth = Math.max(1, fontSize * glyphWidthRatio)
  return Math.max(8, Math.floor(usable / glyphWidth))
}
