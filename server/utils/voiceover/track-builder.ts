/**
 * Текст ролика для ОДНОГО вызова TTS.
 *
 * Посценный синтез рвал интонацию на каждой границе и требовал искусственных
 * вдохов между тейками; единый трек читается как речь живого человека (§3).
 *
 * Маркер паузы `[пауза 2с]` в синтез не попадает — модель прочитала бы его
 * вслух. Он превращается в тишину, которую вставляет шаг озвучки (§4.6).
 *
 * Наружу отдаётся ОЧИЩЕННЫЙ текст по сценам: именно он уходит в выравнивание.
 * Отдай мы исходный, «пауза» и «2с» стали бы словами сценария, которых в
 * транскрипте нет, — и просели бы и `matchedRatio`, и порог деградации.
 */

import type { AlignScene } from "../transcription/align"
import type { MergedScene } from "./script-merge"

export interface TrackPause {
  /** После какой сцены встаёт тишина. */
  afterSceneOrder: number
  durationSec: number
}

export interface TrackRequest {
  text: string
  /** Сцены с текстом без маркеров — вход выравнивания. */
  scenes: AlignScene[]
  pauses: TrackPause[]
}

/**
 * `[пауза 2с]`, `[пауза 1.5 с]` — регистр и пробел не важны.
 *
 * Регулярное выражение создаётся функцией, а не живёт константой: у глобального
 * regexp есть `lastIndex`, и общий экземпляр между вызовами `test`/`matchAll`
 * ведёт себя через раз.
 */
function pauseMarker(): RegExp {
  return /\[пауза\s*(\d+(?:[.,]\d+)?)\s*с\]/gi
}

/** Лимит MiniMax speech-02-turbo; вызывающий может передать лимит своей модели. */
const DEFAULT_MAX_CHARACTERS = 5000

export function buildTrackRequest(
  scenes: readonly MergedScene[],
  options: { maxCharacters?: number } = {},
): TrackRequest {
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS
  const parts: string[] = []
  const cleanedScenes: AlignScene[] = []
  const pauses: TrackPause[] = []

  for (const scene of scenes) {
    const original = scene.text ?? ""
    for (const match of original.matchAll(pauseMarker())) {
      const durationSec = Number.parseFloat(match[1]!.replace(",", "."))
      if (Number.isFinite(durationSec) && durationSec > 0) {
        pauses.push({ afterSceneOrder: scene.order, durationSec })
      }
    }

    const cleaned = original.replace(pauseMarker(), " ").replace(/\s+/g, " ").trim()
    if (!cleaned) continue

    parts.push(cleaned)
    cleanedScenes.push({ order: scene.order, text: cleaned })
  }

  const text = parts.join(" ").trim()
  if (!text) {
    throw new Error("Сборка трека озвучки: пустой текст — синтезировать нечего")
  }
  if (text.length > maxCharacters) {
    throw new Error(
      `Сборка трека озвучки: текст ролика длиннее ${maxCharacters} символов, модель его не примет`,
    )
  }

  return { text, scenes: cleanedScenes, pauses }
}
