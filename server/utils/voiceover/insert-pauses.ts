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
 */

import ffmpeg from "fluent-ffmpeg"
import type { AlignScene } from "../transcription/align"
import { probeAudioDuration } from "../tts"
import type { TrackPause } from "./track-builder"

interface SplitPoint {
  atSec: number
  durationSec: number
}

function splitPointsSec(
  pauses: readonly TrackPause[],
  scenes: readonly AlignScene[],
  totalDurationSec: number,
): SplitPoint[] {
  const totalChars = scenes.reduce((sum, scene) => sum + scene.text.length, 0)
  if (totalChars === 0) return []

  const cumulativeCharsByOrder = new Map<number, number>()
  let running = 0
  for (const scene of scenes) {
    running += scene.text.length
    cumulativeCharsByOrder.set(scene.order, running)
  }

  const points: SplitPoint[] = []
  for (const pause of pauses) {
    const chars = cumulativeCharsByOrder.get(pause.afterSceneOrder)
    if (chars === undefined) continue
    points.push({ atSec: (chars / totalChars) * totalDurationSec, durationSec: pause.durationSec })
  }
  return points.sort((a, b) => a.atSec - b.atSec)
}

/**
 * Разрезает трек по оценённым точкам, вставляет между кусками тишину нужной
 * длины (`anullsrc` как filter source — не нужен отдельный ffmpeg input, см.
 * аналогичный приём в `render.ts`) и склеивает всё обратно `concat`.
 *
 * Если пауз нет или сцены не покрывают ни один маркер — трек возвращается
 * как есть, лишний проход ffmpeg не нужен.
 */
export async function insertVoiceoverPauses(
  path: string,
  pauses: readonly TrackPause[],
  scenes: readonly AlignScene[],
): Promise<string> {
  if (pauses.length === 0) return path

  const totalDurationSec = await probeAudioDuration(path)
  if (totalDurationSec <= 0) return path

  const points = splitPointsSec(pauses, scenes, totalDurationSec)
  if (points.length === 0) return path

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

    const pause = points[index]
    if (pause) {
      const silenceLabel = `sil${index}`
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${pause.durationSec.toFixed(3)},asetpts=N/SR/TB[${silenceLabel}]`)
      labels.push(`[${silenceLabel}]`)
    }
  })
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[aout]`)

  const outputPath = path.replace(/(\.[a-zA-Z0-9]+)?$/, (ext) => `_paused${ext || ".mp3"}`)

  return new Promise((resolve, reject) => {
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
      .on("end", () => resolve(outputPath))
      .on("error", (err) => {
        const tail = stderrTail.slice(-10).join("\n")
        reject(new Error(
          `Не удалось вставить паузы в трек озвучки ${path}: ${err.message}`
          + (tail ? `\n--- stderr ---\n${tail}` : ""),
        ))
      })
      .run()
  })
}
