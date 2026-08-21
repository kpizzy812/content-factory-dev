/**
 * ffmpeg-адаптер для нарезки исходников ведущего.
 *
 * Здесь живут единственные вызовы процессов в ingest-контуре; вся логика порядка
 * работы — в ingest-runner, который тестируется без ffmpeg.
 */

import { spawn } from "node:child_process"

import { detectSceneBoundaries } from "../video-tools/scene-detect"
import {
  DEFAULT_MIN_SILENCE_SEC,
  DEFAULT_SILENCE_NOISE_DB,
  detectSpeechCutPoints,
} from "../video-tools/silence-detect"
import { getVideoDuration } from "../video-tools/ffmpeg"
import { DHASH_HEIGHT, DHASH_WIDTH } from "./perceptual-hash"
import { buildRecordingNormalizeArgs } from "./recording-normalize"
import type { IngestPresenterDependencies } from "./ingest-runner"

const FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || "ffmpeg"
// Только FFPROBE_PATH — тот же единственный env, что читает `getVideoDuration`
// (server/utils/video-tools/ffmpeg.ts) внутри этой же функции probeRecordingMeta.
// Второй алиас развёл бы стенд, где задан только один из них, на два разных бинаря.
const FFPROBE_BIN = process.env.FFPROBE_PATH || "ffprobe"
const CUT_TIMEOUT_MS = 5 * 60_000
const THUMBNAIL_TIMEOUT_MS = 60_000
/** Нормализация записи целиком. Долгая операция: таймаут отдельный. */
const NORMALIZE_TIMEOUT_MS = 60 * 60_000
const PROBE_TIMEOUT_MS = 60_000

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
 * Запуск ffprobe тем же способом, что и `runFfmpeg` — отдельный бинарь,
 * тот же паттерн spawn/timeout/сбор stdout. Второй реализации замера
 * длительности заводить не нужно: она уже есть в `getVideoDuration`.
 */
function runFfprobe(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    const chunks: Buffer[] = []
    let stderr = ""

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL") }
      catch { /* процесс уже мёртв */ }
      reject(new Error(`ffprobe: таймаут ${Math.round(PROBE_TIMEOUT_MS / 1000)}s`))
    }, PROBE_TIMEOUT_MS)

    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk))
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })

    proc.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`ffprobe завершился с кодом ${code}: ${stderr.slice(-400)}`))
        return
      }
      resolve({ stdout: Buffer.concat(chunks), stderr })
    })
  })
}

/**
 * Кадр фрагмента приводится к пределам lip-sync модели: `kling-lip-sync`
 * принимает 720-1080 по ширине и 720-1920 по высоте (LIP_SYNC_CONSTRAINTS).
 * Телефон снимает 4K, после поворота это 2160x3840 — такой фрагмент модель
 * отвергнет, а узнали бы мы об этом на первом платном прогоне.
 *
 * `force_original_aspect_ratio=decrease` вписывает кадр в рамку, а не растягивает:
 * растяжение изменило бы лицо. Второй scale выравнивает стороны до чётных —
 * `yuv420p` нечётные не кодирует.
 */
const CLIP_MAX_WIDTH = 1080
const CLIP_MAX_HEIGHT = 1920
const CLIP_MAX_FPS = 30
const CLIP_SCALE_FILTER
  = `scale=${CLIP_MAX_WIDTH}:${CLIP_MAX_HEIGHT}:force_original_aspect_ratio=decrease`
  + ",scale=trunc(iw/2)*2:trunc(ih/2)*2"

/**
 * Аргументы нарезки. Вынесены отдельно от вызова процесса, чтобы проверить их
 * без ffmpeg: ошибка в порядке `-ss`/`-i` не видна глазами, а стоит десятков
 * минут чтения записи целиком вместо быстрого поиска.
 *
 * Режем с перекодированием, а не `-c copy`: копирование выравнивается по
 * ключевым кадрам и даёт клип не той длины, а Kling принимает строго 2-10 секунд.
 */
export function buildPresenterCutArgs(
  recordingPath: string,
  startSec: number,
  durationSec: number,
  outputPath: string,
): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-y",
    // Поиск ДО входа — по ключевым кадрам и мгновенно. После входа ffmpeg
    // декодировал бы запись от нуля до нужной секунды на каждый фрагмент.
    "-ss", startSec.toFixed(2),
    "-i", recordingPath,
    "-t", durationSec.toFixed(2),
    "-vf", CLIP_SCALE_FILTER,
    // 60 к/с исходника удваивают вес файла, а предел модели — 100 МБ.
    "-r", String(CLIP_MAX_FPS),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
  ]
}

async function cutSegment(
  recordingPath: string,
  startSec: number,
  durationSec: number,
  outputPath: string,
): Promise<void> {
  await runFfmpeg(
    buildPresenterCutArgs(recordingPath, startSec, durationSec, outputPath),
    CUT_TIMEOUT_MS,
    false,
  )
}

/** Нормализация длинной записи целиком (H.264 / 30 fps / AAC, без кропа). */
export async function normalizeRecording(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg(buildRecordingNormalizeArgs(inputPath, outputPath), NORMALIZE_TIMEOUT_MS, false)
}

export interface RecordingMeta {
  durationSec: number
  fps: number | null
  width: number | null
  height: number | null
}

/**
 * Параметры нормализованного файла. Длительность берём через уже существующий
 * `getVideoDuration` (не переписываем замер второй раз), а параметры потока
 * (width/height/r_frame_rate) — локальным запуском ffprobe: она станет верхней
 * границей любого окна реза, и врать здесь нельзя.
 */
export async function probeRecordingMeta(path: string): Promise<RecordingMeta> {
  const durationSec = await getVideoDuration(path)
  const { stdout } = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ])
  const [rawWidth, rawHeight, rawRate] = stdout.toString("utf8").trim().split(/\s+/)
  // Через Number(...) отдельно, а не .map(Number) с деструктуризацией: под
  // noUncheckedIndexedAccess элементы массива — `string | undefined`, и после
  // .map(Number) остались бы `number | undefined` в num/den ниже.
  const [rawNum, rawDen] = (rawRate ?? "").split("/")
  const num = Number(rawNum)
  const den = Number(rawDen)
  return {
    durationSec,
    fps: Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? num / den : null,
    width: Number.parseInt(rawWidth ?? "", 10) || null,
    height: Number.parseInt(rawHeight ?? "", 10) || null,
  }
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

/**
 * Пороги разметки пауз выведены в окружение: у разных микрофонов и помещений
 * «тишина» разная, и подбирать её приходится на материале, а не в коде.
 * Проверять пороги удобно `bun run scripts/ingest-smoke.ts` — он не пишет в БД.
 */
function readNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim()
  if (!raw) return fallback
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : fallback
}

export const ffmpegIngestDependencies: IngestPresenterDependencies = {
  probeDuration: getVideoDuration,
  detectScenes: async (recordingPath, threshold) => {
    const boundaries = await detectSceneBoundaries(recordingPath, threshold)
    return boundaries.map(boundary => boundary.timestampSec)
  },
  detectSilence: (recordingPath, durationSec) => detectSpeechCutPoints(recordingPath, durationSec, {
    noiseDb: readNumberEnv("PRESENTER_SILENCE_NOISE_DB", DEFAULT_SILENCE_NOISE_DB),
    minSilenceSec: readNumberEnv("PRESENTER_SILENCE_MIN_SEC", DEFAULT_MIN_SILENCE_SEC),
  }),
  cutSegment,
  grayscaleThumbnail,
}
