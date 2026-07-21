/**
 * Track F — низкоуровневые ffmpeg/ffprobe операции.
 *
 * Spawn-style по образцу `runFfmpeg` в server/utils/mock/fal-mock.ts:
 *   - не зависит от fluent-ffmpeg;
 *   - захватываем хвост stderr для понятных ошибок;
 *   - duration через ffprobe -of default=noprint_wrappers=1.
 */

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import type { UniqifyParams, PlatformPreset } from "./params"

/** Запускает ffmpeg с заданными аргументами. Захватывает stderr tail для диагностики. */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderrTail: string[] = []
    const proc = spawn("ffmpeg", args)
    proc.stderr.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf-8").split("\n")
      for (const l of lines) {
        if (l.trim()) {
          stderrTail.push(l)
          if (stderrTail.length > 30) stderrTail.shift()
        }
      }
    })
    proc.once("error", reject)
    proc.once("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        const tail = stderrTail.slice(-10).join("\n")
        reject(new Error(`ffmpeg exited with code ${code}\n--- stderr ---\n${tail}`))
      }
    })
  })
}

/** ffprobe duration через text output. */
export function ffprobeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ])
    let stdout = ""
    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf-8") })
    proc.once("error", reject)
    proc.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}`))
        return
      }
      const dur = Number(stdout.trim())
      if (!Number.isFinite(dur) || dur <= 0) {
        reject(new Error(`ffprobe returned invalid duration: '${stdout.trim()}'`))
        return
      }
      resolve(dur)
    })
  })
}

/** SHA-256 файла через streaming read (без загрузки всего в память). */
export function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.once("end", () => resolve(hash.digest("hex")))
    stream.once("error", reject)
  })
}

interface UniqifyOpts {
  inputPath: string
  outputPath: string
  params: UniqifyParams
  preset: PlatformPreset
}

/**
 * Главный ffmpeg pipeline уникализации. Через один command:
 *   - eq=brightness/contrast/saturation
 *   - crop по cropPx с каждой стороны → scale обратно к target
 *   - setpts=PTS/speed (видео ускорение/замедление)
 *   - atempo=speed (аудио без pitch shift)
 *   - libx264 -crf, нужный preset, audio AAC
 *   - -map_metadata -1 (стираем оригинальные метаданные)
 *   - -metadata title= с randomSeed (новые base metadata)
 */
export async function uniqifyVideo(opts: UniqifyOpts): Promise<void> {
  const { inputPath, outputPath, params, preset } = opts
  const { width: w, height: h, fps, preset: x264Preset, audioBitrate } = preset
  const cp = params.cropPx
  const cropFilter = cp > 0
    ? `crop=in_w-${cp * 2}:in_h-${cp * 2}:${cp}:${cp},`
    : ""
  const eqFilter = `eq=brightness=${params.brightness}:contrast=${params.contrast}:saturation=${params.saturation}`
  const speed = params.speed.toFixed(4)
  const videoFilter =
    `[0:v]${cropFilter}scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:-1:-1:color=black,${eqFilter},setpts=PTS/${speed},fps=${fps},format=yuv420p[v]`
  const audioFilter = `[0:a]atempo=${speed},aformat=sample_rates=44100:channel_layouts=stereo[a]`

  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-filter_complex", `${videoFilter};${audioFilter}`,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", x264Preset,
    "-crf", String(params.crf),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", audioBitrate,
    "-ar", "44100",
    "-ac", "2",
    "-map_metadata", "-1",
    "-metadata", `title=variant-${params.randomSeed}`,
    "-metadata", `comment=zc-uniqify-${params.randomSeed}`,
    "-movflags", "+faststart",
    outputPath,
  ])
}
