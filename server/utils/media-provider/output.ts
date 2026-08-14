/**
 * Разбор ответа провайдера в список URL выхода.
 *
 * Форматы, которые реально встречаются: строка, массив, `{ url }`,
 * `{ video: { url } }`, `{ audio: { url } }`, `{ images: [{ url }] }`,
 * `{ output: { audio: { url } } }`, `{ audio_url }`. Раньше это жило тремя
 * разными парсерами (свой в tts.ts, `result.images[0].url` и
 * `result.video.url` в шагах, `extractOutputUrl` в replicate/client.ts).
 *
 * Инвариант: НИЧЕГО не теряем молча. Функция возвращает ВСЕ найденные url;
 * если вызывающему нужен ровно один — он берёт `requireSingleOutputUrl`,
 * который падает и на пустом, и на множественном выходе.
 */

import type { ExtractedMediaOutput } from "./types"

interface OutputEntry {
  url: string
  contentType?: string
}

/** Ключи-контейнеры, в которые провайдеры кладут результат. */
const CONTAINER_KEYS = ["images", "image", "video", "audio", "output", "data"] as const
/** Плоские строковые ключи с прямым url. */
const FLAT_URL_KEYS = ["audio_url", "video_url", "image_url", "output_url"] as const

function collect(raw: unknown, priorityKeys: readonly string[]): OutputEntry[] {
  if (raw === null || raw === undefined) return []

  if (typeof raw === "string") {
    const value = raw.trim()
    return value ? [{ url: value }] : []
  }

  if (Array.isArray(raw)) {
    return raw.flatMap(item => collect(item, priorityKeys))
  }

  if (typeof raw !== "object") return []
  const record = raw as Record<string, unknown>

  // Приоритетные ключи способности идут первыми: у TTS это `audio`, у видео —
  // `video`. Так порядок разбора совпадает с прежним парсером TTS,
  // где `audio.url` выигрывал у верхнеуровневого `url`.
  for (const key of priorityKeys) {
    if (record[key] !== undefined) {
      const nested = collect(record[key], priorityKeys)
      if (nested.length > 0) return nested
    }
  }

  if (typeof record.url === "string" && record.url.trim()) {
    const contentType = typeof record.content_type === "string" ? record.content_type : undefined
    const entry: OutputEntry = { url: record.url.trim() }
    if (contentType) entry.contentType = contentType
    return [entry]
  }

  for (const key of FLAT_URL_KEYS) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return [{ url: value.trim() }]
  }

  for (const key of CONTAINER_KEYS) {
    if (record[key] !== undefined) {
      const nested = collect(record[key], priorityKeys)
      if (nested.length > 0) return nested
    }
  }

  return []
}

export function extractMediaOutput(
  raw: unknown,
  options: { priorityKeys?: readonly string[], defaultContentType?: string } = {},
): ExtractedMediaOutput {
  const entries = collect(raw, options.priorityKeys ?? [])
  const contentType = entries.find(entry => entry.contentType)?.contentType
    ?? options.defaultContentType
  const output: ExtractedMediaOutput = { urls: entries.map(entry => entry.url) }
  if (contentType) output.contentType = contentType
  return output
}

/**
 * Единственный выход на единицу работы. Множественный выход — не «возьмём
 * первый», а ошибка: наш контракт — одна картинка/клип на сцену, и молчаливая
 * потеря остальных уже однажды стоила денег.
 */
export function requireSingleOutputUrl(output: ExtractedMediaOutput, context: string): string {
  if (output.urls.length === 0) {
    throw new Error(`${context}: провайдер не вернул ни одного URL результата`)
  }
  if (output.urls.length > 1) {
    throw new Error(
      `${context}: провайдер вернул ${output.urls.length} URL, контракт — один результат на единицу работы`,
    )
  }
  return output.urls[0]!
}
