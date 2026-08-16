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
 * Итоговая ДЛИТЕЛЬНОСТЬ файла, в отличие от точки разреза, оценкой не
 * является: она пробуется ffprobe уже на готовом результате, а не выводится
 * сложением `исходная + Σ пауз`. Склейка/кодек могут дать не ровно ту сумму
 * (несколько лишних миллисекунд на стыках), а трек — эталон времени для
 * всего дальнейшего монтажа: врать здесь нельзя даже на миллисекунды.
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
 */
export function buildPauseInsertionPlan(
  path: string,
  points: readonly PauseSplitPoint[],
  totalDurationSec: number,
): PauseInsertionPlan {
  const segments: Array<{ start: number, end: number }> = []
  let cursor = 0
  for (const point of points) {
    segments.push({ start: cursor, end: Math.max(cursor, point.atSec) })
    cursor = point.atSec
  }
  segments.push({ start: cursor, end: totalDurationSec })

  const filters: string[] = []
  const labels: string[] = []
  segments.forEach((segment, index) => {
    const segmentLabel = `seg${index}`
    filters.push(`[0:a]atrim=${segment.start.toFixed(3)}:${segment.end.toFixed(3)},asetpts=N/SR/TB[${segmentLabel}]`)
    labels.push(`[${segmentLabel}]`)

    const point = points[index]
    if (point) {
      const silenceLabel = `sil${index}`
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${point.durationSec.toFixed(3)},asetpts=N/SR/TB[${silenceLabel}]`)
      labels.push(`[${silenceLabel}]`)
    }
  })
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[aout]`)

  const outputPath = path.replace(/(\.[a-zA-Z0-9]+)?$/, (ext) => `_paused${ext || ".mp3"}`)
  return { filters, outputPath }
}

export interface InsertPausesResult {
  path: string
  /** Измерено ffprobe на готовом файле — не сумма исходной длительности и пауз. */
  durationSec: number
  /** Паузы, для которых не нашлось точки вставки — тишина по ним НЕ добавлена. */
  skippedPauses: TrackPause[]
}

/**
 * Вставка тишины: пробует исходную длительность, планирует разрез (чистая
 * часть выше), запускает ffmpeg и пробует РЕЗУЛЬТАТ — длительность в ответе
 * всегда измерена на готовом файле, не выведена сложением.
 */
export async function insertVoiceoverPauses(
  path: string,
  pauses: readonly TrackPause[],
  scenes: readonly AlignScene[],
): Promise<InsertPausesResult> {
  if (pauses.length === 0) {
    return { path, durationSec: await probeAudioDuration(path), skippedPauses: [] }
  }

  const totalDurationSec = await probeAudioDuration(path)
  if (totalDurationSec <= 0) {
    // Не измерили исходник — резать по оценённым долям не от чего.
    return { path, durationSec: totalDurationSec, skippedPauses: [...pauses] }
  }

  const { points, skipped } = planPauseSplit(pauses, scenes, totalDurationSec)
  if (points.length === 0) {
    return { path, durationSec: totalDurationSec, skippedPauses: skipped }
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

  const durationSec = await probeAudioDuration(outputPath)
  return { path: outputPath, durationSec, skippedPauses: skipped }
}
