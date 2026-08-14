/**
 * Ручная проверка нарезки на реальном ffmpeg.
 *
 * Запуск:
 *   bun run scripts/ingest-smoke.ts <запись> [--plan-only] [--max-clips=N]
 *                                   [--noise-db=-30] [--min-silence=0.4]
 *
 * `--plan-only` останавливается после разметки границ и плана окон: ничего не
 * режет и не хеширует. Это то, чем подбирают пороги — нарезка записи 4K60
 * перекодирует каждый кадр и идёт часами, а план считается за минуты.
 *
 * В БД и хранилище скрипт не пишет никогда.
 */
import { spawn } from "node:child_process"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ffmpegIngestDependencies } from "../server/utils/presenter/ffmpeg-adapter"
import { ingestPresenterRecording } from "../server/utils/presenter/ingest-runner"
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  DHASH_HEIGHT,
  DHASH_WIDTH,
  areFramesSimilar,
  dHashFromGrayscale,
} from "../server/utils/presenter/perceptual-hash"
import { planPresenterSegments } from "../server/utils/presenter/segment-planner"
import { getVideoDuration } from "../server/utils/video-tools/ffmpeg"
import {
  DEFAULT_MIN_SILENCE_SEC,
  DEFAULT_SILENCE_NOISE_DB,
  detectSilenceRanges,
  silenceCutPoints,
} from "../server/utils/video-tools/silence-detect"

const args = process.argv.slice(2)
const recordingPath = args.find(arg => !arg.startsWith("--"))
if (!recordingPath) {
  console.error("Usage: bun run scripts/ingest-smoke.ts <recording> [--plan-only] [--max-clips=N] [--noise-db=-30] [--min-silence=0.4]")
  process.exit(1)
}

/**
 * dHash кадра по таймкоду прямо из исходника. `-ss` перед `-i` — быстрый поиск
 * по ключевым кадрам, ровно как в `cutSegment`: значит и кадр тот же самый.
 */
function hashFrameAt(path: string, atSec: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-nostats",
      "-ss", atSec.toFixed(2),
      "-i", path,
      "-frames:v", "1",
      "-vf", `scale=${DHASH_WIDTH}:${DHASH_HEIGHT}:flags=area,format=gray`,
      "-f", "rawvideo",
      "-",
    ], { stdio: ["ignore", "pipe", "ignore"] })

    const chunks: Buffer[] = []
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    proc.on("error", reject)
    proc.on("close", () => {
      const buffer = Buffer.concat(chunks)
      const expected = DHASH_WIDTH * DHASH_HEIGHT
      if (buffer.length < expected) {
        reject(new Error(`ffmpeg вернул ${buffer.length} байт вместо ${expected}`))
        return
      }
      resolve(dHashFromGrayscale(new Uint8Array(buffer.subarray(0, expected))))
    })
  })
}

function flagNumber(name: string, fallback: number): number {
  const raw = args.find(arg => arg.startsWith(`--${name}=`))?.split("=")[1]
  const value = raw === undefined ? Number.NaN : Number.parseFloat(raw)
  return Number.isFinite(value) ? value : fallback
}

const planOnly = args.includes("--plan-only")
const hashOnly = args.includes("--hash-only")
const maxClips = flagNumber("max-clips", Number.POSITIVE_INFINITY)
const noiseDb = flagNumber("noise-db", DEFAULT_SILENCE_NOISE_DB)
const minSilenceSec = flagNumber("min-silence", DEFAULT_MIN_SILENCE_SEC)

const durationSec = await getVideoDuration(recordingPath)
console.log(`запись: ${recordingPath}`)
console.log(`длительность: ${durationSec.toFixed(2)}s (${(durationSec / 60).toFixed(1)} мин)`)
console.log(`пороги: noise=${noiseDb}dB, min-silence=${minSilenceSec}s`)

console.log("\n— разметка пауз —")
const started = Date.now()
const ranges = await detectSilenceRanges(recordingPath, { noiseDb, minSilenceSec })
console.log(`найдено пауз: ${ranges.length} за ${((Date.now() - started) / 1000).toFixed(1)}s`)

if (ranges.length > 0) {
  const lengths = ranges.map(range => range.endSec - range.startSec).sort((a, b) => a - b)
  const median = lengths[Math.floor(lengths.length / 2)]!
  console.log(
    `длина паузы: мин ${lengths[0]!.toFixed(2)}s, медиана ${median.toFixed(2)}s, `
    + `макс ${lengths[lengths.length - 1]!.toFixed(2)}s`,
  )
  const speech = ranges.length + 1
  console.log(`речевых кусков между паузами: ~${speech}`)
}

const cutPoints = silenceCutPoints(ranges, { durationSec, minSilenceSec })
console.log(`точек реза (без ведущей и хвостовой тишины): ${cutPoints.length}`)

console.log("\n— план окон (2-10s) —")
const planned = planPresenterSegments({ durationSec, sceneBoundaries: cutPoints })
console.log(`окон: ${planned.length}`)
const tooLong = cutPoints.length > 0
  ? planned.filter(segment => segment.durationSec >= 9.99).length
  : planned.length
console.log(`из них упёрлись в потолок 10s (значит фраза длиннее и порезана по таймеру): ${tooLong}`)
for (const segment of planned.slice(0, 40)) {
  console.log(`  ${segment.startSec.toFixed(2)}-${segment.endSec.toFixed(2)}s (${segment.durationSec.toFixed(2)}s)`)
}
if (planned.length > 40) console.log(`  … ещё ${planned.length - 40}`)

if (hashOnly) {
  // Дедуп решает судьбу библиотеки: на однородной съёмке стартовые кадры
  // фрагментов похожи, и порог 6 бит может выкосить почти всё. Кадр берём прямо
  // из исходника по таймкоду окна — это тот же кадр, что попал бы в клип, но без
  // перекодирования всей записи.
  console.log("\n— хеши стартовых кадров —")
  const hashes: string[] = []
  const hashStarted = Date.now()
  for (const [index, segment] of planned.entries()) {
    try {
      hashes.push(await hashFrameAt(recordingPath, segment.startSec))
    }
    catch (error) {
      console.log(`  ${segment.startSec.toFixed(2)}s: кадр не снят — ${error instanceof Error ? error.message : String(error)}`)
    }
    if ((index + 1) % 20 === 0) console.log(`  … ${index + 1}/${planned.length}`)
  }
  console.log(`снято хешей: ${hashes.length} за ${((Date.now() - hashStarted) / 1000).toFixed(1)}s`)

  console.log("\n— сколько переживёт дедуп при разных порогах —")
  for (const threshold of [4, 6, 8, 10, 12, 14]) {
    const accepted: string[] = []
    for (const hash of hashes) {
      if (accepted.some(known => areFramesSimilar(known, hash, threshold))) continue
      accepted.push(hash)
    }
    const mark = threshold === DEFAULT_SIMILARITY_THRESHOLD ? "  ← текущий порог" : ""
    console.log(
      `  порог ${String(threshold).padStart(2)} бит: принято ${String(accepted.length).padStart(3)} `
      + `из ${hashes.length} (отброшено ${hashes.length - accepted.length})${mark}`,
    )
  }
  process.exit(0)
}

if (planOnly) {
  console.log("\n--plan-only: нарезка и хеши пропущены")
  process.exit(0)
}

console.log("\n— нарезка и хеши —")
const outputDir = await mkdtemp(join(tmpdir(), "ingest-smoke-"))
try {
  const result = await ingestPresenterRecording(
    { recordingPath, outputDir, maxClips: Number.isFinite(maxClips) ? maxClips : undefined },
    ffmpegIngestDependencies,
  )

  console.log(`границы размечены: ${result.boundarySource}`)
  console.log(`scene detection упал: ${result.sceneDetectionFailed}`)
  console.log(`принято клипов: ${result.clips.length}, отброшено: ${result.skipped.length}`)
  console.log(`похожих по первому кадру: ${result.similarClips}`)

  for (const clip of result.clips) {
    const info = await stat(clip.filePath)
    console.log(
      `  ${clip.startSec.toFixed(2)}-${clip.endSec.toFixed(2)}s `
      + `(${clip.durationSec.toFixed(2)}s) hash=${clip.perceptualHash} bytes=${info.size}`,
    )
  }
  for (const skip of result.skipped) {
    console.log(`  SKIP ${skip.startSec}-${skip.endSec}: ${skip.reason} ${skip.message ?? ""}`)
  }
}
finally {
  await rm(outputDir, { recursive: true, force: true }).catch(() => {})
}
