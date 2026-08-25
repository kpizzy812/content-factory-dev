/**
 * Субтитры кадрового монтажа — окна считаются от АБСОЛЮТНОГО времени трека,
 * а не от длительностей клипов сцен в склейке (Task 6, «Сборка по кадрам»).
 *
 * Главное упрощение задачи. На старом маршруте окно субтитра считалось от
 * длительностей клипов в СКЛЕЙКЕ, поэтому `AlignedScene.order` приходилось
 * переводить в позицию клипа через `alignedScenesByClipPosition` (карта
 * `positionByOrder`, см. `subtitles/aligned-scene-position.ts`). На кадровом
 * маршруте кадры по построению покрывают трек ровно теми же абсолютными
 * секундами, что и `AlignedScene.startSec/endSec` — `VideoShot.startSec/
 * endSec` живут в том же пространстве координат. Позиционное сопоставление
 * не нужно вовсе: перестановка сцен на входе ничего не меняет в выходе,
 * потому что мы нигде не читаем ИНДЕКС сцены во входном массиве, только её
 * собственные абсолютные границы.
 */

import { chunkSceneSpeech } from "../subtitles/phrase-chunker"
import { wordsForChunk } from "../subtitles/aligned-words"
import type { AlignedScene } from "../transcription/align"
import type { AssSegmentInput } from "../subtitles/ass-builder/dialogue"
import type { SubtitlePlacement } from "~~/shared/types/story"

export interface TrackSubtitleInput {
  alignedScenes: readonly AlignedScene[]
  /** Текст и раскладка сцены сценария по её order. */
  scenesByOrder: ReadonlyMap<number, { text: string; placement?: SubtitlePlacement }>
  maxChars?: number
}

/** Раскладка по умолчанию — та же, что использует легаси-путь для нижних субтитров. */
const DEFAULT_PLACEMENT: SubtitlePlacement = { position: "bottom", alignment: "center", avoidZones: [] }

/**
 * Строит ASS-сегменты субтитров кадрового маршрута.
 *
 * Сцены сортируются по `startSec` — вход не обязан идти в порядке трека (см.
 * тест «позиционного сопоставления нет вовсе»), а сегменты на выходе обязаны
 * идти по возрастанию времени. Сцена без текста сценария (либо отсутствующая
 * в `scenesByOrder` вовсе) субтитра не получает и хвост остальных сцен не
 * сдвигает — у каждой сцены свои границы, независимые от соседей.
 */
export function buildTrackSubtitleSegments(input: TrackSubtitleInput): AssSegmentInput[] {
  const segments: AssSegmentInput[] = []
  const sortedScenes = [...input.alignedScenes].sort((a, b) => a.startSec - b.startSec)

  for (const scene of sortedScenes) {
    const source = input.scenesByOrder.get(scene.order)
    const text = source?.text?.trim() ?? ""
    if (!source || text.length === 0) continue

    const chunks = chunkSceneSpeech(text, scene.startSec, scene.endSec, { maxChars: input.maxChars })

    for (const chunk of chunks) {
      // Реальные тайминги выравнивания для слов чанка — не равномерная оценка
      // (см. докстринг wordsForChunk). Не нашлись — билдер ASS оценит сам.
      const words = wordsForChunk({
        words: scene.words,
        chunkText: chunk.text,
        chunkStartSec: chunk.startSec,
        chunkEndSec: chunk.endSec,
      })

      segments.push({
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        text: chunk.text,
        placement: source.placement ?? DEFAULT_PLACEMENT,
        words: words.length > 0 ? words : undefined,
      })
    }
  }

  return segments
}
