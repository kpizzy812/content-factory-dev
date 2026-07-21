/**
 * Hardcoded pool generic-комментариев для warmup-actions.
 *
 * Используется только для mature-аккаунтов и только в action.kind === 'comment'.
 * Минимально нейтральные фразы, чтобы не нарушать ToS платформ и не вызывать модерацию.
 *
 * Для итерации 1 — hardcoded в коде. В будущем можно вынести в WarmupKeywordPool
 * с category='comments'.
 */

import type { SeededRng } from "./rng"

const RU_COMMENTS: readonly string[] = [
  "нравится 🔥",
  "полезно",
  "спасибо!",
  "класс!",
  "круто",
  "топ ✨",
]

const EN_COMMENTS: readonly string[] = [
  "love this",
  "nice 🔥",
  "thanks!",
  "great",
  "amazing",
  "🔥🔥🔥",
]

export function pickComment(rng: SeededRng, language: string): string {
  const lang = (language || "en").toLowerCase()
  const pool = lang === "ru" ? RU_COMMENTS : EN_COMMENTS
  return pool[rng.int(0, pool.length - 1)]!
}

export function commentPoolSize(language: string): number {
  const lang = (language || "en").toLowerCase()
  return lang === "ru" ? RU_COMMENTS.length : EN_COMMENTS.length
}
