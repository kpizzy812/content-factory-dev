/**
 * Раскладка выровненных слов сцены (`align.ts`) по чанкам субтитра.
 *
 * chunkSceneSpeech режет реплику сцены на короткие фразы для показа — каждая
 * представляет собой непрерывную подстроку текста сцены. Здесь эта подстрока
 * ищется среди выровненных слов сцены (`AlignedScene.words`), чтобы забрать
 * их РЕАЛЬНЫЕ тайминги вместо равномерной оценки (`estimateWordTimings` в
 * word-timings.ts): союз может звучать 0.1 с, а равномерная раскладка отдала
 * бы ему долю фразы — и увела бы караоке-подсветку от звука.
 *
 * Сравнение текстов — той же нормализацией, что и в самом выравнивании
 * (`normalizeToken` из align.ts): регистр, ё/е, окружающая пунктуация.
 *
 * Не нашли непрерывного совпадения — возвращаем пустой список. Это не ошибка,
 * а явный сигнал вызывающему коду: подставлять «примерно похожие» слова
 * нельзя, лучше равномерная оценка, чем подсветка чужого слова.
 *
 * Окно чанка при этом — не факт, а ОЦЕНКА: chunkSceneSpeech режет фразу
 * пропорционально числу символов, независимо от реального темпа речи. Если
 * сцена звучит неровно (пауза внутри фразы, рывок в конце), сумма реальных
 * длительностей найденных слов может оказаться БОЛЬШЕ окна чанка. Karaoke-тег
 * `\k` в ASS-билдере (dialogue.ts) кумулятивен от начала строки — если сумма
 * длительностей превышает длительность самой строки, подсветка не успевает
 * дойти до последних слов раньше, чем ASS переключит субтитр, и эффект рвётся
 * на середине. Слова при этом остаются верными — портится сам эффект,
 * который у равномерной оценки по построению всегда укладывался в окно.
 * Поэтому длительности, не влезающие в окно, сжимаются в него пропорционально
 * (относительная неравномерность сохраняется), а не отбрасываются: ни один
 * потребитель (dialogue.ts, keyword-emphasis.ts) не читает абсолютное
 * положение слова — только разницу `endSec - startSec`, так что сжатие ничего
 * не искажает и гарантирует, что сумма уложится в строку.
 */

import { normalizeToken } from '../transcription/align'
import type { AlignedWord } from '../transcription/align'

export interface AlignedChunkWord {
  text: string
  startSec: number
  endSec: number
}

export function wordsForChunk(input: {
  words: readonly AlignedWord[]
  chunkText: string
  chunkStartSec: number
  chunkEndSec: number
}): AlignedChunkWord[] {
  const chunkTokens = input.chunkText
    .split(/\s+/)
    .map(normalizeToken)
    .filter(token => token.length > 0)

  if (chunkTokens.length === 0 || input.words.length === 0) return []

  // Ищем ВСЕ непрерывные отрезки слов сцены, совпадающие с чанком по тексту —
  // фраза может повториться в сцене больше одного раза.
  const candidates: number[] = []
  for (let start = 0; start + chunkTokens.length <= input.words.length; start += 1) {
    let matches = true
    for (let offset = 0; offset < chunkTokens.length; offset += 1) {
      if (normalizeToken(input.words[start + offset]!.text) !== chunkTokens[offset]) {
        matches = false
        break
      }
    }
    if (matches) candidates.push(start)
  }

  if (candidates.length === 0) return []

  // При нескольких вхождениях берём то, чьё начало ближе всего ко времени
  // самого чанка — окно чанка (Task 10) и тайминги выравнивания считаны по
  // одному и тому же звуку, поэтому совпадающее вхождение должно быть рядом.
  let best = candidates[0]!
  let bestDelta = Math.abs(input.words[best]!.startSec - input.chunkStartSec)
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i]!
    const delta = Math.abs(input.words[candidate]!.startSec - input.chunkStartSec)
    if (delta < bestDelta) {
      best = candidate
      bestDelta = delta
    }
  }

  const slice = input.words.slice(best, best + chunkTokens.length)
  return fitWithinWindow(slice, input.chunkStartSec, input.chunkEndSec)
}

/**
 * Гарантирует, что сумма длительностей слов не превышает окно чанка (см.
 * комментарий модуля). В пределах окна — тайминги отдаются как есть. Не
 * влезли — сжимаем длительности одним общим коэффициентом и раскладываем их
 * друг за другом от chunkStartSec: относительные пропорции (кто звучал
 * дольше, кто короче) сохраняются, только исчезает исходный зазор между
 * словами — karaoke эту паузу и так не рисует (см. dialogue.ts:153).
 */
function fitWithinWindow(
  words: readonly AlignedWord[],
  chunkStartSec: number,
  chunkEndSec: number,
): AlignedChunkWord[] {
  const totalDuration = words.reduce((sum, word) => sum + Math.max(0, word.endSec - word.startSec), 0)
  const windowDuration = Math.max(0, chunkEndSec - chunkStartSec)

  if (totalDuration <= windowDuration) {
    return words.map(word => ({ text: word.text, startSec: word.startSec, endSec: word.endSec }))
  }

  // Окна без длины (chunkEndSec <= chunkStartSec) сжимать некуда — честнее
  // отдать пустой список и уйти на равномерную оценку, чем схлопнуть все слова
  // в одну точку.
  if (windowDuration === 0) return []

  const scale = windowDuration / totalDuration
  let cursor = chunkStartSec
  return words.map((word) => {
    const duration = Math.max(0, word.endSec - word.startSec) * scale
    const scaled: AlignedChunkWord = { text: word.text, startSec: cursor, endSec: cursor + duration }
    cursor += duration
    return scaled
  })
}
