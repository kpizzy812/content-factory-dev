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
  maxClips?: number
}

export interface IngestPresenterDependencies {
  probeDuration(recordingPath: string): Promise<number>
  detectScenes(recordingPath: string, threshold: number): Promise<number[]>
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

export interface IngestPresenterResult {
  durationSec: number
  clips: IngestedClip[]
  skipped: SkippedSegment[]
  /** true, если ffmpeg не смог разметить сцены и запись поделена равномерно. */
  sceneDetectionFailed: boolean
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
  try {
    sceneBoundaries = await deps.detectScenes(
      input.recordingPath,
      input.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD,
    )
  }
  catch {
    // Разметка сцен — оптимизация, а не обязательный шаг: без неё режем равномерно.
    sceneDetectionFailed = true
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
        skipped.push({ startSec: segment.startSec, endSec: segment.endSec, reason: "duplicate" })
        continue
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

  return { durationSec, clips, skipped, sceneDetectionFailed }
}
