/**
 * ffmpeg-адаптер для нарезки исходников ведущего.
 *
 * Здесь живут единственные вызовы процессов в ingest-контуре; вся логика порядка
 * работы — в ingest-runner, который тестируется без ffmpeg.
 */

import { spawn } from "node:child_process"

import { detectSceneBoundaries } from "../video-tools/scene-detect"
import { getVideoDuration } from "../video-tools/ffmpeg"
import { DHASH_HEIGHT, DHASH_WIDTH } from "./perceptual-hash"
import type { IngestPresenterDependencies } from "./ingest-runner"

const FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || "ffmpeg"
const CUT_TIMEOUT_MS = 5 * 60_000
const THUMBNAIL_TIMEOUT_MS = 60_000

interface RunResult {
  stdout: Buffer
  stderr: string
}

function runFfmpeg(args: string[], timeoutMs: number, collectStdout: boolean): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, {
      stdio: ["ignore", collectStdout ? "pipe" : "ignore", "pipe"],
    })

    const chunks: Buffer[] = []
    let stderr = ""

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL") }
      catch { /* процесс уже мёртв */ }
      reject(new Error(`ffmpeg: таймаут ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk))
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })

    proc.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`ffmpeg завершился с кодом ${code}: ${stderr.slice(-400)}`))
        return
      }
      resolve({ stdout: Buffer.concat(chunks), stderr })
    })
  })
}

/**
 * Режем с перекодированием, а не `-c copy`: копирование выравнивается по
 * ключевым кадрам и даёт клип не той длины, а Kling принимает строго 2-10 секунд.
 */
async function cutSegment(
  recordingPath: string,
  startSec: number,
  durationSec: number,
  outputPath: string,
): Promise<void> {
  await runFfmpeg([
    "-hide_banner",
    "-nostats",
    "-y",
    "-ss", startSec.toFixed(2),
    "-i", recordingPath,
    "-t", durationSec.toFixed(2),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
  ], CUT_TIMEOUT_MS, false)
}

/**
 * Сырые 9x8 серых пикселей прямо из ffmpeg — так не нужен декодер изображений
 * и лишняя зависимость ради одного кадра.
 */
async function grayscaleThumbnail(clipPath: string): Promise<Uint8Array> {
  const { stdout } = await runFfmpeg([
    "-hide_banner",
    "-nostats",
    "-i", clipPath,
    "-frames:v", "1",
    "-vf", `scale=${DHASH_WIDTH}:${DHASH_HEIGHT}:flags=area,format=gray`,
    "-f", "rawvideo",
    "-",
  ], THUMBNAIL_TIMEOUT_MS, true)

  const expected = DHASH_WIDTH * DHASH_HEIGHT
  if (stdout.length < expected) {
    throw new Error(`ffmpeg вернул ${stdout.length} байт вместо ${expected} для кадра ${DHASH_WIDTH}x${DHASH_HEIGHT}`)
  }
  return new Uint8Array(stdout.subarray(0, expected))
}

export const ffmpegIngestDependencies: IngestPresenterDependencies = {
  probeDuration: getVideoDuration,
  detectScenes: async (recordingPath, threshold) => {
    const boundaries = await detectSceneBoundaries(recordingPath, threshold)
    return boundaries.map(boundary => boundary.timestampSec)
  },
  cutSegment,
  grayscaleThumbnail,
}
