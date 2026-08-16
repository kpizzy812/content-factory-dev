/**
 * Транскрипт нашей собственной озвучки.
 *
 * Нужен не ради текста — текст известен из сценария, — а ради ГРАНИЦ: по ним
 * режутся кадры, показываются субтитры и считается фактическая длина сцены
 * (spec 2026-08-16-audio-first-editing §4).
 */

export interface TranscriptWord {
  /** Слово без окружающей пунктуации и пробелов. */
  text: string
  startSec: number
  endSec: number
}

export interface Transcript {
  words: TranscriptWord[]
  /** Полный распознанный текст: для диагностики и отчёта оператору. */
  text: string
}
