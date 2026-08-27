/**
 * Тишина в едином треке по маркерам пауз.
 *
 * `buildTrackRequest` уже вырезал маркеры `[пауза 2с]` из текста — модель не
 * прочитала их вслух, но и не оставила на их месте разрыва в речи. Единый
 * трек синтезируется ОДНИМ вызовом TTS (§3), поэтому точных таймингов сцен
 * внутри него на этом шаге ещё нет — они появляются только после выравнивания
 * (`transcription/align.ts`), которое идёт следующим шагом по уже готовому
 * треку.
 *
 * Точка разреза здесь оценивается по доле символов текста сцен до маркера
 * относительно всего текста трека: скорость речи TTS в пределах одного
 * непрерывного вызова примерно постоянна, и это единственная опора, которая
 * есть на этом шаге. Оценка приблизительная и это нормально — выравнивание
 * пересчитает границы сцен уже по факту готового трека, тишина в его расчётах
 * будет видна как обычная пауза в речи.
 *
 * Итоговая ДЛИТЕЛЬНОСТЬ файла в норме — не оценка: она пробуется ffprobe
 * уже на готовом результате, а не выводится сложением `исходная + Σ пауз`
 * (склейка/кодек могут дать не ровно ту сумму — несколько лишних миллисекунд
 * на стыках), а трек — эталон времени для всего дальнейшего монтажа: врать
 * здесь нельзя даже на миллисекунды. Но если ffprobe транзиентно не смог
 * измерить (см. `InsertPausesResult.durationEstimated`), в ответ идёт лучшая
 * ДОСТУПНАЯ оценка вместо лжи про ноль — честно помеченная как оценка, а не
 * тихо выданная за факт.
 *
 * Чистые части (расчёт точек разреза, сборка ffmpeg-фильтров) вынесены в
 * отдельные функции и тестируются без запуска ffmpeg — по образцу
 * `buildStillClipArgs` (`video-tools/still-clip.ts`) и
 * `parseSilenceRangesFromStderr` (`video-tools/silence-detect.ts`).
 */

import ffmpeg from "fluent-ffmpeg"
import type { AlignScene } from "../transcription/align"
import { probeAudioDuration } from "../tts"
import type { TrackPause } from "./track-builder"

export interface PauseSplitPoint {
  afterSceneOrder: number
  atSec: number
  durationSec: number
}

export interface PauseSplitPlan {
  /** Точки вставки, для которых нашлась опорная сцена — отсортированы по времени. */
  points: PauseSplitPoint[]
  /** Паузы, для которых в `scenes` нет сцены с таким `order` — вставить их некуда. */
  skipped: TrackPause[]
}

/**
 * Точка разреза внутри трека — по доле символов текста сцен до маркера
 * относительно всего текста. Чистая функция: длительность трека приходит
 * уже посчитанной, ffmpeg здесь нет вовсе.
 *
 * Сцена с паузой может отсутствовать в `scenes`: `buildTrackRequest` кладёт
 * паузу в список ДО проверки на пустой очищенный текст, поэтому сцена,
 * состоящая целиком из маркера паузы (без единого слова), даёт паузу без
 * своей записи в `scenes`. Для такой паузы точки разреза нет — она уходит в
 * `skipped`, а не тихо теряется.
 */
export function planPauseSplit(
  pauses: readonly TrackPause[],
  scenes: readonly AlignScene[],
  totalDurationSec: number,
): PauseSplitPlan {
  const totalChars = scenes.reduce((sum, scene) => sum + scene.text.length, 0)
  if (totalChars === 0) return { points: [], skipped: [...pauses] }

  const cumulativeCharsByOrder = new Map<number, number>()
  let running = 0
  for (const scene of scenes) {
    running += scene.text.length
    cumulativeCharsByOrder.set(scene.order, running)
  }

  const points: PauseSplitPoint[] = []
  const skipped: TrackPause[] = []
  for (const pause of pauses) {
    const chars = cumulativeCharsByOrder.get(pause.afterSceneOrder)
    if (chars === undefined) {
      skipped.push(pause)
      continue
    }
    points.push({
      afterSceneOrder: pause.afterSceneOrder,
      atSec: (chars / totalChars) * totalDurationSec,
      durationSec: pause.durationSec,
    })
  }
  points.sort((a, b) => a.atSec - b.atSec)
  return { points, skipped }
}

export interface PauseInsertionPlan {
  /** Граф `filter_complex`: разрез исходника + тишина `anullsrc` + `concat`. */
  filters: string[]
  outputPath: string
}

/**
 * ffmpeg-план разреза трека по точкам и вставки тишины между кусками.
 * Чистая функция: собирает `filter_complex`, процесс не запускает.
 *
 * `anullsrc` используется как filter source (не отдельный ffmpeg input) —
 * тот же приём, что и в `render.ts` для немого клипа.
 *
 * Куски НУЛЕВОЙ длины в граф не попадают. Такой кусок — вход `concat` без
 * единого сэмпла: ffmpeg на нём в лучшем случае мусорит на стыке, в худшем
 * падает, и разбираться придётся уже по stderr готового ролика. Появляются
 * они не в экзотике, а штатно:
 * - маркер в конце ПОСЛЕДНЕЙ сцены даёт точку разреза ровно на длине трека
 *   (хвостовой кусок `[D..D]`) — это и есть случай локальной замены, где
 *   синтезируется одна фраза и пауза стоит в её конце;
 * - два маркера в одной сцене дают две точки с одинаковым `atSec`, между
 *   ними кусок `[t..t]`;
 * - сцена без символов ставит точку в начало трека — кусок `[0..0]`.
 *
 * «Нулевой» считается по тем числам, которые РЕАЛЬНО уедут в ffmpeg (после
 * округления до миллисекунд), а не по исходным: 4.0001..4.0002 в графе
 * выглядит как `atrim=4.000:4.000` и режется точно так же насухо.
 */
export function buildPauseInsertionPlan(
  path: string,
  points: readonly PauseSplitPoint[],
  totalDurationSec: number,
): PauseInsertionPlan {
  const filters: string[] = []
  const labels: string[] = []
  let pieceIndex = 0

  const pushSegment = (start: number, end: number): void => {
    const startText = start.toFixed(3)
    const endText = end.toFixed(3)
    if (Number(endText) - Number(startText) <= 0) return

    const label = `seg${pieceIndex++}`
    filters.push(`[0:a]atrim=${startText}:${endText},asetpts=N/SR/TB[${label}]`)
    labels.push(`[${label}]`)
  }

  let cursor = 0
  points.forEach((point, index) => {
    const end = Math.max(cursor, point.atSec)
    pushSegment(cursor, end)

    const silenceLabel = `sil${index}`
    filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${point.durationSec.toFixed(3)},asetpts=N/SR/TB[${silenceLabel}]`)
    labels.push(`[${silenceLabel}]`)
    cursor = end
  })
  pushSegment(cursor, totalDurationSec)

  if (labels.length === 0) {
    // `concat=n=0` — заведомо битая команда. Отказ с внятной причиной лучше,
    // чем ffmpeg, падающий на разборе фильтра где-то в середине конвейера.
    throw new Error("Вставка пауз в трек озвучки: резать нечего — ни одного куска звука и ни одной паузы")
  }
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[aout]`)

  const outputPath = path.replace(/(\.[a-zA-Z0-9]+)?$/, (ext) => `_paused${ext || ".mp3"}`)
  return { filters, outputPath }
}

export interface InsertPausesResult {
  path: string
  /**
   * Готовая длительность. Измерена ffprobe, КРОМЕ случая, когда замер не
   * удался (`durationEstimated: true`) — тогда это лучшая доступная оценка,
   * а не факт. Ноль сюда никогда не попадает: он уезжает в снапшот шага и в
   * `VideoAsset.duration`, где молча отключает и подгон длины клипов, и
   * реальные тайминги субтитров.
   */
  durationSec: number
  /** Паузы, для которых не нашлось точки вставки — тишина по ним НЕ добавлена. */
  skippedPauses: TrackPause[]
  /**
   * true, если не удалось измерить ИСХОДНИК (до разреза) — в этом случае
   * `skippedPauses` содержит ВСЕ переданные паузы не потому, что для них не
   * нашлось опорной сцены, а потому что резать по оценённым долям было не от
   * чего измерить. Вызывающий код обязан различать эти причины в логе — иначе
   * сообщение соврёт про «не нашли точку вставки» там, где дело в сбое ffprobe.
   */
  sourceDurationMeasureFailed: boolean
  /**
   * true, если `durationSec` — оценка, а не измерение готового файла ffprobe
   * (независимо от причины: пустой список пауз, неизмеримый исходник или
   * неизмеримый результат после ffmpeg). Значение кэшируется дальше по
   * конвейеру как факт, поэтому вызывающий код обязан честно сообщить об
   * оценке в лог, а не промолчать.
   */
  durationEstimated: boolean
}

/**
 * Вставка тишины: пробует исходную длительность, планирует разрез (чистая
 * часть выше), запускает ffmpeg и пробует РЕЗУЛЬТАТ.
 *
 * `probeAudioDuration` при сбое ffprobe не бросает, а возвращает 0 — транзиент
 * на только что созданном файле не должен превращаться в нулевую длительность
 * трека (эталона времени всего дальнейшего монтажа). Поэтому на каждой из
 * трёх точек замера ниже неположительный результат подменяется на лучшую
 * доступную оценку — не враньё про ноль, но и не подмена «как будто измерено»:
 * `durationEstimated` честно говорит, что это не факт.
 */
export async function insertVoiceoverPauses(
  path: string,
  pauses: readonly TrackPause[],
  scenes: readonly AlignScene[],
  synthDurationSec: number,
): Promise<InsertPausesResult> {
  if (pauses.length === 0) {
    // Пауз нет — сложить нечего, лучшая оценка при неудачном замере это
    // длина синтеза как есть.
    const measured = await probeAudioDuration(path)
    return {
      path,
      durationSec: measured > 0 ? measured : synthDurationSec,
      skippedPauses: [],
      sourceDurationMeasureFailed: false,
      durationEstimated: measured <= 0,
    }
  }

  const totalDurationSec = await probeAudioDuration(path)
  if (totalDurationSec <= 0) {
    // Не измерили исходник — резать по оценённым долям не от чего, паузы не
    // вставлены вовсе, поэтому длина синтеза (без пауз) — лучшая оценка. Все
    // паузы остаются без вставки, но по ДРУГОЙ причине, чем «не нашли
    // опорную сцену» — см. sourceDurationMeasureFailed.
    return {
      path,
      durationSec: synthDurationSec,
      skippedPauses: [...pauses],
      sourceDurationMeasureFailed: true,
      durationEstimated: true,
    }
  }

  const { points, skipped } = planPauseSplit(pauses, scenes, totalDurationSec)
  if (points.length === 0) {
    return {
      path,
      durationSec: totalDurationSec,
      skippedPauses: skipped,
      sourceDurationMeasureFailed: false,
      durationEstimated: false,
    }
  }

  const { filters, outputPath } = buildPauseInsertionPlan(path, points, totalDurationSec)

  await new Promise<void>((resolve, reject) => {
    const stderrTail: string[] = []
    ffmpeg()
      .input(path)
      .complexFilter(filters, ["aout"])
      .outputOptions(["-c:a", "libmp3lame", "-b:a", "192k", "-y"])
      .output(outputPath)
      .on("stderr", (line: string) => {
        stderrTail.push(line)
        if (stderrTail.length > 20) stderrTail.shift()
      })
      .on("end", () => resolve())
      .on("error", (err) => {
        const tail = stderrTail.slice(-10).join("\n")
        reject(new Error(
          `Не удалось вставить паузы в трек озвучки ${path}: ${err.message}`
          + (tail ? `\n--- stderr ---\n${tail}` : ""),
        ))
      })
      .run()
  })

  const measuredResultSec = await probeAudioDuration(outputPath)
  // Паузы РЕАЛЬНО вставлены (сплайсинг прошёл) — в отличие от исходника,
  // здесь есть чем оценить результат точнее длины синтеза: исходник уже
  // измерен, а вставленная тишина известна поточечно. Сумма — не подмена
  // синтезом (который вообще не учитывал бы паузы), а честная оценка того,
  // что ffprobe не смог подтвердить на готовом файле.
  const estimatedResultSec = totalDurationSec + points.reduce((sum, point) => sum + point.durationSec, 0)
  return {
    path: outputPath,
    durationSec: measuredResultSec > 0 ? measuredResultSec : estimatedResultSec,
    skippedPauses: skipped,
    sourceDurationMeasureFailed: false,
    durationEstimated: measuredResultSec <= 0,
  }
}
