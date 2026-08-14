/**
 * Нарезка длинной записи ведущего на пригодные для lip-sync фрагменты.
 *
 * Оркестрация с внедрёнными зависимостями: сам ffmpeg живёт в адаптере, поэтому
 * весь порядок работы проверяется unit-тестами без единого процесса и файла.
 *
 * Похожие фрагменты отбрасываются здесь же. Без этого одна длинная запись даст
 * десяток почти одинаковых клипов, и ролики начнут повторяться кадр в кадр —
 * ровно то, что docs/PROJECT_CONTEXT.md §7 запрещает.
 */

import { areFramesSimilar, dHashFromGrayscale } from "./perceptual-hash"
import { planPresenterSegments } from "./segment-planner"

export interface IngestPresenterInput {
  recordingPath: string
  /** Каталог для нарезанных клипов. Создаёт вызывающий код. */
  outputDir: string
  /** Хеши того, что уже лежит в библиотеке этого ведущего. */
  existingHashes?: string[]
  minDurationSec?: number
  maxDurationSec?: number
  paddingSec?: number
  sceneThreshold?: number
  /** Порог похожести в битах. Меньше — строже. */
  similarityThreshold?: number
  /**
   * Отбрасывать ли фрагмент, чей первый кадр похож на уже принятый.
   *
   * Не задано — решает способ разметки границ: при резке по паузам отбор
   * выключен, при резке по склейкам оставлен. Причина в измерении на реальной
   * записи ведущей: 10 минут одним дублем на одном фоне дали 106 фрагментов,
   * из которых дедуп по dHash первого кадра оставил 6. dHash сжимает кадр до
   * 9x8 серых пикселей, и у говорящей головы на статичном фоне все кадры там
   * одинаковы — разные фразы и жесты в этот сигнал не попадают.
   *
   * Точный повтор (одна запись, залитая дважды) ловится не хешом, а
   * `@@unique([characterId, sha1])` в схеме.
   */
  dropSimilarClips?: boolean
  maxClips?: number
}

export interface IngestPresenterDependencies {
  probeDuration(recordingPath: string): Promise<number>
  detectScenes(recordingPath: string, threshold: number): Promise<number[]>
  /**
   * Точки реза по речевым паузам. Необязательна: вызывающие, которые её не
   * передали, работают по прежнему пути (разметка склеек).
   */
  detectSilence?(recordingPath: string, durationSec: number): Promise<number[]>
  cutSegment(
    recordingPath: string,
    startSec: number,
    durationSec: number,
    outputPath: string,
  ): Promise<void>
  grayscaleThumbnail(clipPath: string): Promise<Uint8Array>
}

export interface IngestedClip {
  filePath: string
  startSec: number
  endSec: number
  durationSec: number
  perceptualHash: string
}

export interface SkippedSegment {
  startSec: number
  endSec: number
  reason: "duplicate" | "error"
  message?: string
}

/** Чем размечены границы: паузами речи, видеосклейками или ничем. */
export type IngestBoundarySource = "silence" | "scene" | "none"

export interface IngestPresenterResult {
  durationSec: number
  clips: IngestedClip[]
  skipped: SkippedSegment[]
  /** true, если ffmpeg не смог разметить сцены и запись поделена равномерно. */
  sceneDetectionFailed: boolean
  /**
   * `none` означает, что запись поделена равными кусками по таймеру — границы
   * попадут в середину слова, и это видно в логе, а не втихую.
   */
  boundarySource: IngestBoundarySource
  /**
   * Сколько фрагментов оказались похожи на уже принятые по первому кадру.
   * При выключенном отборе они всё равно приняты — но молчать об этом нельзя:
   * если материал реально дублируется, оператор должен это видеть.
   */
  similarClips: number
}

const DEFAULT_SCENE_THRESHOLD = 0.4

function clipFileName(index: number): string {
  return `clip-${String(index).padStart(3, "0")}.mp4`
}

export async function ingestPresenterRecording(
  input: IngestPresenterInput,
  deps: IngestPresenterDependencies,
): Promise<IngestPresenterResult> {
  const durationSec = await deps.probeDuration(input.recordingPath)

  let sceneBoundaries: number[] = []
  let sceneDetectionFailed = false
  let boundarySource: IngestBoundarySource = "none"

  // Паузы речи первыми: съёмка ведущей — один непрерывный дубль, склеек в ней
  // нет, а границы фраз есть. Заодно это дёшево — детектор не декодирует видео,
  // тогда как разметка склеек проходит каждый кадр (на 4K60 это десятки минут).
  if (deps.detectSilence) {
    try {
      const speechCuts = await deps.detectSilence(input.recordingPath, durationSec)
      if (speechCuts.length > 0) {
        sceneBoundaries = speechCuts
        boundarySource = "silence"
      }
    }
    catch {
      // Отказ детектора пауз не отменяет нарезку: ниже пробуем склейки.
    }
  }

  if (boundarySource === "none") {
    try {
      sceneBoundaries = await deps.detectScenes(
        input.recordingPath,
        input.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD,
      )
      if (sceneBoundaries.length > 0) boundarySource = "scene"
    }
    catch {
      // Разметка сцен — оптимизация, а не обязательный шаг: без неё режем равномерно.
      sceneDetectionFailed = true
    }
  }

  const planned = planPresenterSegments({
    durationSec,
    sceneBoundaries,
    minDurationSec: input.minDurationSec,
    maxDurationSec: input.maxDurationSec,
    paddingSec: input.paddingSec,
  })

  const clips: IngestedClip[] = []
  const skipped: SkippedSegment[] = []
  const seenHashes = [...(input.existingHashes ?? [])]
  // Границы дали паузы — фрагменты по построению разные фразы, и отбор по
  // первому кадру выкосил бы почти весь материал (см. dropSimilarClips).
  const dropSimilar = input.dropSimilarClips ?? boundarySource !== "silence"
  let similarClips = 0

  for (const [index, segment] of planned.entries()) {
    if (input.maxClips !== undefined && clips.length >= input.maxClips) break

    // Имя по позиции в плане, а не по числу принятых клипов: пропуски в
    // нумерации безвредны, зато файл всегда соответствует своему окну реза
    // и не перезаписывается следующим сегментом.
    const filePath = `${input.outputDir}/${clipFileName(index + 1)}`
    try {
      await deps.cutSegment(input.recordingPath, segment.startSec, segment.durationSec, filePath)
      const thumbnail = await deps.grayscaleThumbnail(filePath)
      const perceptualHash = dHashFromGrayscale(thumbnail)

      const duplicate = seenHashes.some(known =>
        areFramesSimilar(known, perceptualHash, input.similarityThreshold))
      if (duplicate) {
        similarClips += 1
        if (dropSimilar) {
          skipped.push({ startSec: segment.startSec, endSec: segment.endSec, reason: "duplicate" })
          continue
        }
      }

      seenHashes.push(perceptualHash)
      clips.push({
        filePath,
        startSec: segment.startSec,
        endSec: segment.endSec,
        durationSec: segment.durationSec,
        perceptualHash,
      })
    }
    catch (error) {
      // Один битый кусок не должен ронять разбор всей записи.
      skipped.push({
        startSec: segment.startSec,
        endSec: segment.endSec,
        reason: "error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { durationSec, clips, skipped, sceneDetectionFailed, boundarySource, similarClips }
}
