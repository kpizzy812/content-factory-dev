/**
 * Кусок общего трека под одну сцену.
 *
 * На маршруте «монтаж от звука» речь ролика синтезирована ОДНИМ вызовом TTS
 * (§3), и именно этот трек лежит под таймлайном. Посценный синтез на таком
 * ролике вреден вдвойне: у модели TTS нет seed, вторая запись звучит иначе той,
 * что уже в сборке (губы разъезжаются со звуком), и платится она второй раз.
 * Поэтому звук сцены не синтезируется, а ВЫРЕЗАЕТСЯ из готового трека по
 * границам выравнивания (`transcription/align.ts`).
 *
 * Планирование границ — чистая функция без ffmpeg (по образцу
 * `planPauseSplit` в `insert-pauses.ts`): её видно тестом, и никакой процесс
 * для проверки арифметики запускать не нужно.
 *
 * Ключ переиспользования куска строится от ИНТЕРВАЛА и ОТПЕЧАТКА ТРЕКА, а не от
 * текста реплики (spec §4.4). Текст может не измениться при полностью
 * перезаписанном треке — и тогда ключ от текста подставил бы к свежему звуку
 * старые губы.
 */

import { createHash } from "node:crypto"
import ffmpeg from "fluent-ffmpeg"
import type { AlignedScene } from "../transcription/align"

export interface SegmentCut {
  startSec: number
  endSec: number
  durationSec: number
  /**
   * Интервал пришлось подогнать под требования модели по длительности.
   * Вызывающий обязан написать об этом в лог: модель получит кусок не той
   * длины, что дало выравнивание, и молчать об этом нельзя.
   */
  clampedToModel: boolean
}

export interface SegmentCutInput {
  scene: Pick<AlignedScene, "order" | "startSec" | "endSec">
  /** Длительность общего трека: за неё кусок вылезать не имеет права. */
  trackDurationSec: number
  /** Частота кадров ролика; <= 0 — притягивать границы не к чему. */
  fps: number
  /** Требования lip-sync модели к длительности материала. */
  model: { minDurationSec: number, maxDurationSec: number }
}

/** Есть ли к чему притягивать границы: fps должен быть конечным и положительным. */
function usableFps(fps: number): boolean {
  return Number.isFinite(fps) && fps > 0
}

/** Ближайшая граница кадра. */
function snapToFrame(sec: number, fps: number): number {
  return usableFps(fps) ? Math.round(sec * fps) / fps : sec
}

/** Граница кадра НЕ ПОЗЖЕ заданной секунды — для верхних потолков. */
function floorToFrame(sec: number, fps: number): number {
  return usableFps(fps) ? Math.floor(sec * fps) / fps : sec
}

/** Граница кадра НЕ РАНЬШЕ заданной секунды — для нижних порогов. */
function ceilToFrame(sec: number, fps: number): number {
  return usableFps(fps) ? Math.ceil(sec * fps) / fps : sec
}

/**
 * Границы куска: от выравнивания, притянутые к кадру, обрезанные длиной трека и
 * зажатые в диапазон длительности модели.
 *
 * Порядок именно такой. Сначала кадр — сборка режет видео по кадрам, и звук,
 * начатый в середине кадра, уезжает от картинки на полкадра уже на старте.
 * Потом трек — за его конец звука просто нет. И только потом модель: её
 * диапазон это ограничение инструмента, а не факт материала.
 *
 * Короткий кусок удлиняется сначала вперёд, а упершись в конец трека — назад:
 * иначе сцена в самом конце ролика (последние 1.5 с трека) не набрала бы
 * минимума модели никогда.
 */
export function planSegmentCut(input: SegmentCutInput): SegmentCut {
  const { fps, model, trackDurationSec } = input
  const trackEnd = Number.isFinite(trackDurationSec) && trackDurationSec > 0
    ? floorToFrame(trackDurationSec, fps)
    : Number.POSITIVE_INFINITY

  let startSec = Math.max(0, snapToFrame(input.scene.startSec, fps))
  let endSec = Math.min(snapToFrame(input.scene.endSec, fps), trackEnd)
  if (startSec > trackEnd) startSec = Math.max(0, trackEnd)
  if (endSec < startSec) endSec = startSec

  let clampedToModel = false
  const duration = endSec - startSec

  if (Number.isFinite(model.maxDurationSec) && duration > model.maxDurationSec) {
    // Вниз до кадра: округление вверх дало бы кусок длиннее потолка модели,
    // и провайдер отбил бы вызов уже после оплаты подготовки.
    endSec = floorToFrame(startSec + model.maxDurationSec, fps)
    clampedToModel = true
  } else if (Number.isFinite(model.minDurationSec) && duration < model.minDurationSec) {
    clampedToModel = true
    endSec = Math.min(ceilToFrame(startSec + model.minDurationSec, fps), trackEnd)
    // Трек кончился раньше, чем набрался минимум — забираем недостающее слева.
    // Если и слева не хватило (весь трек короче минимума), отдаём что есть:
    // выдумывать звук, которого нет, хуже, чем честно короткий кусок.
    if (endSec - startSec < model.minDurationSec) {
      startSec = Math.max(0, floorToFrame(endSec - model.minDurationSec, fps))
    }
  }

  return { startSec, endSec, durationSec: endSec - startSec, clampedToModel }
}

export interface SegmentIdentityInput {
  videoId: number
  sceneOrder: number
  startSec: number
  endSec: number
  /**
   * Отпечаток самого трека. Пересинтезированный трек обязан обесценить все
   * ранее вырезанные куски: текст сцены при этом мог не измениться ни на букву.
   */
  trackFingerprint: string
}

/**
 * Отпечаток куска: ролик, сцена, границы с точностью до миллисекунды и трек.
 * Текста реплики здесь нет намеренно — см. шапку модуля.
 */
export function segmentIdentity(input: SegmentIdentityInput): string {
  return createHash("sha1")
    .update([
      input.videoId,
      input.sceneOrder,
      Math.round(input.startSec * 1000),
      Math.round(input.endSec * 1000),
      input.trackFingerprint,
    ].join(" "))
    .digest("hex")
}

export interface CutTrackSegmentResult {
  path: string
  /** Измерено на готовом файле, а не взято из плана: перекодировка даёт свой хвост. */
  durationSec: number
}

/**
 * Вырезает кусок трека в отдельный файл.
 *
 * `-ss` ставится ВХОДНЫМ параметром (быстрая перемотка), длина задаётся `-t`, а
 * не `-to`: после входной перемотки таймстемпы сбрасываются, и `-to` в разных
 * сборках ffmpeg считается то от начала файла, то от точки реза — на платном
 * шаге такой лотереи быть не должно.
 *
 * Поток перекодируется (libmp3lame), а не копируется: mp3-фрейм длится ~26 мс,
 * и копия резалась бы по границе фрейма, а не по границе кадра видео.
 */
export async function cutTrackSegment(input: {
  trackPath: string
  outputPath: string
  cut: SegmentCut
  probeDuration: (path: string) => Promise<number | null>
}): Promise<CutTrackSegmentResult> {
  const { cut, outputPath, trackPath } = input

  await new Promise<void>((resolve, reject) => {
    const stderrTail: string[] = []
    ffmpeg(trackPath)
      .seekInput(cut.startSec)
      .duration(cut.durationSec)
      .outputOptions(["-c:a", "libmp3lame", "-b:a", "192k", "-y"])
      .output(outputPath)
      .on("stderr", (line: string) => {
        stderrTail.push(line)
        if (stderrTail.length > 20) stderrTail.shift()
      })
      .on("end", () => resolve())
      .on("error", (err: Error) => {
        const tail = stderrTail.slice(-10).join("\n")
        reject(new Error(
          `Не удалось вырезать кусок ${cut.startSec.toFixed(3)}-${cut.endSec.toFixed(3)}с из трека ${trackPath}: ${err.message}`
          + (tail ? `\n--- stderr ---\n${tail}` : ""),
        ))
      })
      .run()
  })

  const measured = await input.probeDuration(outputPath)
  return { path: outputPath, durationSec: measured ?? cut.durationSec }
}
