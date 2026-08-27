/**
 * Границы слов после локальной замены сегмента.
 *
 * Транскрибировать весь трек заново незачем: до точки вклейки не изменился ни
 * один сэмпл, а после неё всё уехало ровно на разницу длительностей. Границы
 * внутри новой фразы приходят из транскрипции ТОЛЬКО ЕЁ — это один короткий
 * платный вызов вместо повторной разметки всего ролика.
 *
 * Границы притягиваются к кадру той же функцией, что и вырезка кусков:
 * решение №3 хендоффа — ключ переиспользования куска считается по притянутым
 * границам, и дрожание в миллисекундах иначе переоплатит lip-sync всего ролика.
 * Отсюда же главное правило списка на пересборку: в него попадает не всякая
 * сцена после точки вклейки, а только та, у которой ПРИТЯНУТАЯ К КАДРУ граница
 * реально стала другой. Сдвиг меньше половины кадра даёт тот же кадр, тот же
 * вырезанный кусок и тот же ключ — платить за него второй раз не за что.
 *
 * Про дельту. Точная длина склеенного трека арифметикой не выводится
 * (решение №5): `acrossfade` накладывает потоки друг на друга и укорачивает
 * результат на кроссфейд с КАЖДОГО стыка, плюс своё добавляет перекодировка.
 * Поэтому дельта берётся из измеренной ffprobe длины склейки, если она уже
 * есть. Замер бывает не всегда — интерфейс должен уметь ответить «что
 * пересоберётся» ДО оплаты вклейки, по одной лишь оценке длительности фразы, —
 * и тогда дельта считается аналитически, с той же поправкой на кроссфейды.
 *
 * Функция чистая и не мутирует вход: старое выравнивание остаётся в снапшоте
 * шага, и порча его на месте отняла бы возможность откатиться.
 */

import type { AlignedScene, AlignedWord } from "../transcription/align"
import { snapSecToFrame } from "./segment-cut"
import type { SplicePlan } from "./segment-splice"

/**
 * Допуск сравнения границ. Секунда здесь приходит из транскрипции с точностью
 * до миллисекунд, и «ровно на границе» после сложения double не бывает точным.
 */
const BOUNDARY_EPS_SEC = 1e-6

export interface ShiftInput {
  scenes: readonly AlignedScene[]
  plan: SplicePlan
  /** Транскрипт пересинтезированной фразы: границы отсчитаны от её начала. */
  replacementScene: AlignedScene
  /** Измеренная длительность пересинтезированного файла. */
  replacementDurationSec: number
  /**
   * Измеренная длительность трека ДО вклейки. Нужна не только для арифметики:
   * по ней видно, есть ли у склейки хвост, то есть сколько стыков кроссфейда
   * укоротили результат (ровно та же развилка, что в `buildSpliceFilters`).
   */
  trackDurationSec: number
  /**
   * Измеренная ffprobe длительность трека ПОСЛЕ вклейки. Если она уже есть —
   * дельта берётся из неё: это единственная точная величина (решение №5).
   * Ноль и прочий мусор игнорируются намеренно: `probeAudioDuration` при ошибке
   * ffprobe ВОЗВРАЩАЕТ 0, а не бросает, и принятый за длину склейки ноль
   * сдвинул бы весь хвост ролика на минус длину трека.
   */
  splicedTrackDurationSec?: number
  fps: number
}

export interface ShiftResult {
  scenes: AlignedScene[]
  /** Насколько удлинился (или укоротился) трек. */
  deltaSec: number
  /**
   * Сцены, чьи кадры обязаны быть пересобраны: заменённая, сцены со сдвинутыми
   * границами и сцены, которые вырез задел. Порядок — заменённая первой, дальше
   * по ходу трека; дубликаты сняты (`order` в проекте повторяется).
   *
   * Сцены нет в `scenes`, но её order есть здесь — значит вырез съел её целиком,
   * и её кадр не пересобирается, а удаляется.
   */
  movedSceneOrders: number[]
}

/** Сдвиг слов с притяжкой к кадру. Новые объекты: вход не мутируется. */
function shiftWords(words: readonly AlignedWord[], bySec: number, fps: number): AlignedWord[] {
  return words.map(word => ({
    ...word,
    startSec: snapSecToFrame(word.startSec + bySec, fps),
    endSec: snapSecToFrame(word.endSec + bySec, fps),
  }))
}

export function shiftAlignmentAfterSplice(input: ShiftInput): ShiftResult {
  const { fps, plan, replacementDurationSec, replacementScene, trackDurationSec } = input

  // Отрицательный кроссфейд ffmpeg всё равно не примет, а здесь он удлинил бы
  // трек «за счёт стыков» — арифметика ушла бы в другую сторону от реальности.
  const crossfadeSec = Math.max(0, plan.crossfadeSec)
  const removedSec = plan.cutEndSec - plan.cutStartSec

  // Стыки считаются ровно как куски в `buildSpliceFilters`: голова есть, если
  // режем не с нуля; хвост — если режем не до конца трека.
  const hasHead = plan.cutStartSec > 0
  const hasTail = plan.cutEndSec < trackDurationSec
  const seamCount = (hasHead ? 1 : 0) + (hasTail ? 1 : 0)

  const measured = input.splicedTrackDurationSec
  const measurable = typeof measured === "number" && Number.isFinite(measured) && measured > 0
    && Number.isFinite(trackDurationSec) && trackDurationSec > 0
  const deltaSec = measurable
    ? measured - trackDurationSec
    : replacementDurationSec - removedSec - crossfadeSec * seamCount

  // Точка, с которой новая фраза звучит в СКЛЕЕННОМ треке. Это не `cutStartSec`:
  // acrossfade накладывает начало фразы на хвост головы, и фраза начинается на
  // кроссфейд раньше реза. Без головы накладывать не на что — точка та же.
  // Зажим по нулю: `crossfadeSec` приходит снаружи и сверху не ограничен, а
  // отрицательное начало фразы означало бы отрицательные границы субтитров.
  const spliceAtSec = Math.max(0, plan.cutStartSec - (hasHead ? crossfadeSec : 0))

  const scenes: AlignedScene[] = []
  const movedSceneOrders: number[] = []
  let replacementPlaced = false

  function placeReplacement(): void {
    scenes.push({
      ...replacementScene,
      startSec: snapSecToFrame(spliceAtSec + replacementScene.startSec, fps),
      endSec: snapSecToFrame(spliceAtSec + replacementScene.endSec, fps),
      words: shiftWords(replacementScene.words, spliceAtSec, fps),
    })
    replacementPlaced = true
  }

  // Заменённая сцена всегда в списке на пересборку: её звук другой даже тогда,
  // когда длина совпала до миллисекунды, а губы под старым звуком — брак.
  movedSceneOrders.push(replacementScene.order)

  for (const scene of input.scenes) {
    // Целиком до выреза: не двигается вовсе.
    if (scene.endSec <= plan.cutStartSec + BOUNDARY_EPS_SEC) {
      scenes.push({
        ...scene,
        startSec: snapSecToFrame(scene.startSec, fps),
        endSec: snapSecToFrame(scene.endSec, fps),
        words: shiftWords(scene.words, 0, fps),
      })
      continue
    }

    // Целиком после выреза: уезжает на дельту.
    if (scene.startSec >= plan.cutEndSec - BOUNDARY_EPS_SEC) {
      const startSec = snapSecToFrame(scene.startSec + deltaSec, fps)
      const endSec = snapSecToFrame(scene.endSec + deltaSec, fps)
      scenes.push({ ...scene, startSec, endSec, words: shiftWords(scene.words, deltaSec, fps) })
      // Сравнение именно ПРИТЯНУТЫХ границ, а не дельты с нулём: см. шапку
      // модуля, решение №3. Обе величины получены одной и той же `snapSecToFrame`,
      // поэтому равные кадры дают побитово равные double.
      const movedOnTimeline = startSec !== snapSecToFrame(scene.startSec, fps)
        || endSec !== snapSecToFrame(scene.endSec, fps)
      if (movedOnTimeline) movedSceneOrders.push(scene.order)
      continue
    }

    // Пересекается с вырезом. Заменённая сцена встаёт на место выреза со своими
    // границами — но ровно один раз: `order` в проекте дублируется (см.
    // комментарий в `transcription/align.ts`), и второй такой же order обязан
    // пойти общим путём, иначе новая фраза попала бы в трек дважды.
    if (scene.order === replacementScene.order && !replacementPlaced) {
      placeReplacement()
      continue
    }

    // Задетая вырезом чужая сцена. Выкидывать её целиком нельзя: рез идёт по
    // тишине, а тишина бывает и ВНУТРИ соседней реплики — тогда половина её
    // слов звучит в треке дальше, и потерять к ним субтитры значит испортить
    // ролик там, где его не правили. Уцелевшие слова — те, что целиком вне
    // выреза; те, что до реза, стоят на месте, те, что после, едут на дельту.
    const survivors: AlignedWord[] = []
    for (const word of scene.words) {
      if (word.endSec <= plan.cutStartSec + BOUNDARY_EPS_SEC) {
        survivors.push({
          ...word,
          startSec: snapSecToFrame(word.startSec, fps),
          endSec: snapSecToFrame(word.endSec, fps),
        })
        continue
      }
      if (word.startSec >= plan.cutEndSec - BOUNDARY_EPS_SEC) {
        survivors.push({
          ...word,
          startSec: snapSecToFrame(word.startSec + deltaSec, fps),
          endSec: snapSecToFrame(word.endSec + deltaSec, fps),
        })
      }
    }

    // Задело в любом случае — кадр пересобирается или удаляется.
    movedSceneOrders.push(scene.order)
    // Не уцелело ни слова: сцена жила внутри выреза и исчезла вместе с ним.
    // Оставить её значило бы описывать несуществующий отрезок трека.
    if (survivors.length === 0) continue

    scenes.push({
      ...scene,
      startSec: survivors[0]!.startSec,
      endSec: survivors[survivors.length - 1]!.endSec,
      words: survivors,
    })
  }

  // Заменяемой сцены могло не быть в исходном списке: `alignScriptToTranscript`
  // выбрасывает сцены, которым не досталось ни одного токена.
  if (!replacementPlaced) placeReplacement()

  // Вставленная в конец замена обязана встать в своё место на таймлайне: дальше
  // по списку идут субтитры и нарезка кусков, и обратный порядок дал бы кадр,
  // который начинается раньше предыдущего.
  scenes.sort((a, b) => a.startSec - b.startSec)
  return { scenes, deltaSec, movedSceneOrders: [...new Set(movedSceneOrders)] }
}
