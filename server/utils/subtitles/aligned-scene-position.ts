/**
 * Перевод «сцена → её реальный клип» в пространство индексов уплотнённой склейки.
 *
 * `AlignedScene.order` — исходный индекс сцены в `videoPlan.scenes`. Субтитры
 * и ASS-сегменты адресуются ДРУГИМ индексом — позицией в `clips[]` ПОСЛЕ
 * `compactSceneClipPaths` (video-pipeline-steps.ts), который выкидывает сцены
 * без клипа (частичная генерация) и сдвигает хвост. На ролике без единого
 * пропуска эти два индекса случайно совпадают, поэтому спутать их незаметно —
 * ровно так на само-ревью Task 11 нашёлся баг: первая версия сопоставляла
 * `AlignedScene.order` напрямую с позицией окна субтитра.
 *
 * `positionByOrder` — та же карта, что уже uses `fitClipsToTrack` (Task 10) для
 * перевода order → позиция; здесь она переиспользуется, а не считается заново.
 */

import type { AlignedScene } from "../transcription/align"

/**
 * Раскладывает выровненные сцены по позициям в уплотнённой склейке.
 * Сцене, которой не досталось клипа (её order отсутствует в positionByOrder),
 * в результат положить нечего — она пропускается.
 */
export function alignedScenesByClipPosition(
  alignedScenes: readonly AlignedScene[],
  positionByOrder: ReadonlyMap<number, number>,
): Map<number, AlignedScene> {
  const byPosition = new Map<number, AlignedScene>()
  for (const scene of alignedScenes) {
    const position = positionByOrder.get(scene.order)
    if (position !== undefined) byPosition.set(position, scene)
  }
  return byPosition
}
