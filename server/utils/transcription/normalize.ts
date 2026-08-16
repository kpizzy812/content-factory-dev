/**
 * Приведение ответа модели транскрипции к нашему транскрипту.
 *
 * Обёртки Whisper отдают слова тремя способами: `chunks` с парой timestamp,
 * `segments[].words` и плоский `words`. Разбор живёт здесь, а не в спеке модели,
 * чтобы смена модели не тянула правку выравнивания и субтитров.
 *
 * Слово без валидных границ выбрасывается, а не получает ноль: ноль встал бы в
 * начало ролика и утащил бы туда субтитр.
 */

import type { Transcript, TranscriptWord } from "./types"

interface RawWordLike {
  text?: unknown
  word?: unknown
  start?: unknown
  end?: unknown
  timestamp?: unknown
}

function cleanWord(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim().replace(/^[.,;:!?…«»"'`()\[\]{}]+|[.,;:!?…«»"'`()\[\]{}]+$/g, "")
}

function readSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

function toWord(raw: RawWordLike): TranscriptWord | null {
  const text = cleanWord(raw.text ?? raw.word)
  if (!text) return null

  let startSec = readSeconds(raw.start)
  let endSec = readSeconds(raw.end)

  if (Array.isArray(raw.timestamp)) {
    startSec = readSeconds(raw.timestamp[0])
    endSec = readSeconds(raw.timestamp[1])
  }

  if (startSec === null || endSec === null || endSec < startSec) return null
  return { text, startSec, endSec }
}

function collectWords(raw: Record<string, unknown>): TranscriptWord[] {
  const direct = Array.isArray(raw.words) ? raw.words : null
  const chunks = Array.isArray(raw.chunks) ? raw.chunks : null
  const segments = Array.isArray(raw.segments) ? raw.segments : null

  const source: unknown[] = direct ?? chunks ?? (segments ?? []).flatMap((segment) => {
    const nested = (segment as { words?: unknown }).words
    return Array.isArray(nested) ? nested : []
  })

  const words: TranscriptWord[] = []
  for (const item of source) {
    if (!item || typeof item !== "object") continue
    const word = toWord(item as RawWordLike)
    if (word) words.push(word)
  }
  return words
}

export function normalizeTranscriptPayload(raw: unknown): Transcript {
  if (!raw || typeof raw !== "object") {
    throw new Error("Транскрипция вернула не объект — разбирать нечего")
  }

  const record = raw as Record<string, unknown>
  const words = collectWords(record)
  if (words.length === 0) {
    throw new Error("Транскрипция вернула ответ без границ слов: монтировать по нему нельзя")
  }

  const text = typeof record.text === "string" && record.text.trim()
    ? record.text.trim()
    : words.map(word => word.text).join(" ")

  return { words, text }
}
