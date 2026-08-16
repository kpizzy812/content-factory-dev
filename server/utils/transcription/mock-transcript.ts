/**
 * Транскрипт для мок-режима: детерминированный, бесплатный и ОСМЫСЛЕННЫЙ.
 *
 * Заглушка вида «мок транскрипции» из `replicate/json-model.ts` доводит вызов
 * до конца, но не доводит до конца МАРШРУТ: выравнивание не узнаёт ни одного
 * слова сценария, границы всех сцен схлопываются в полторы секунды, подгон
 * клипов под трек отказывается работать (`planAlignedClipTargets` видит
 * нулевой бакет), и «собранный» ролик оказывается длиннее звука на всю разницу.
 * То есть на стенде маршрут молча деградировал, а проверить это было нечем.
 *
 * Здесь мок отдаёт то же, что отдал бы идеальный распознаватель НАШЕЙ ЖЕ
 * озвучки: слова сценария, равномерно разложенные по измеренной длительности
 * трека. Ничего не выдумывается — и текст, и длительность известны вызывающему
 * до вызова провайдера.
 */

import type { AlignScene } from "./align"

export interface MockTranscriptChunk {
  text: string
  /** Пара [начало, конец] — форма `chunks`, которую понимает normalize.ts. */
  timestamp: [number, number]
}

export interface MockTranscriptPayload {
  text: string
  chunks: MockTranscriptChunk[]
}

/** Миллисекунды: больше точности мок не изображает, и результат стабилен. */
function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function buildMockTranscript(input: {
  scenes: readonly AlignScene[]
  audioSeconds: number
}): MockTranscriptPayload {
  const words = input.scenes
    .flatMap(scene => scene.text.split(/\s+/))
    .map(word => word.trim())
    .filter(word => word.length > 0)

  if (words.length === 0 || !(input.audioSeconds > 0)) {
    return { text: "", chunks: [] }
  }

  const step = input.audioSeconds / words.length
  const chunks = words.map((word, index) => ({
    text: word,
    timestamp: [roundMs(index * step), roundMs((index + 1) * step)] as [number, number],
  }))

  return { text: words.join(" "), chunks }
}
