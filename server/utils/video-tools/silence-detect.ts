/**
 * Разметка речевых пауз через `ffmpeg -af silencedetect`.
 *
 * Зачем отдельно от `scene-detect.ts`: тот ищет смену КАРТИНКИ и на записи
 * ведущей бесполезен — один непрерывный дубль на одном фоне склеек не содержит,
 * и детектор честно возвращает пустой список. Границы фраз в такой записи
 * размечает звук.
 *
 * Видео не декодируется вовсе (`-vn`): на записи 4K60 длиной десять минут это
 * разница между секундами и десятками минут работы.
 *
 * Best-effort, как и разметка сцен: при таймауте или ненулевом коде разбираем
 * то, что успело прийти в stderr. Пустой результат означает «границ не нашли»,
 * а не отказ — вызывающий откатывается на прежний способ.
 */
import { spawn } from "node:child_process"

const FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || "ffmpeg"
const SILENCE_DETECT_TIMEOUT_MS = 10 * 60_000

/** Порог тишины в дБ. −30 дБ — обычная граница для речи, снятой на петличку или телефон. */
export const DEFAULT_SILENCE_NOISE_DB = -30
/** Пауза короче этого — вдох или межсловный интервал, а не граница фразы. */
export const DEFAULT_MIN_SILENCE_SEC = 0.4
/** Насколько близко к краю записи пауза считается «ведущей» или «хвостовой». */
const EDGE_EPSILON_SEC = 0.05

export interface SilenceRange {
  startSec: number
  endSec: number
}

export interface SilenceDetectOptions {
  noiseDb?: number
  minSilenceSec?: number
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Разбор stderr `silencedetect`. Формат строк:
 *   [silencedetect @ 0x…] silence_start: 4.512
 *   [silencedetect @ 0x…] silence_end: 5.238 | silence_duration: 0.726
 *
 * Экспортируется ради теста без ffmpeg.
 */
export function parseSilenceRangesFromStderr(stderr: string): SilenceRange[] {
  const re = /silence_(start|end):\s*(-?[0-9]+(?:\.[0-9]+)?)/g
  const ranges: SilenceRange[] = []
  let pendingStart: number | null = null
  let match: RegExpExecArray | null

  while ((match = re.exec(stderr)) !== null) {
    const value = Number.parseFloat(match[2]!)
    if (!Number.isFinite(value)) continue
    // Запись, начинающаяся с тишины, даёт silence_start: -0.00012.
    // Math.max отдаёт именно +0, а не -0 — иначе значение утекает в сравнения.
    const seconds = Math.max(0, round(value))

    if (match[1] === "start") {
      pendingStart = seconds
      continue
    }
    // Конец без начала — обрывок вывода; закрывать им нечего.
    if (pendingStart === null) continue
    if (seconds > pendingStart) ranges.push({ startSec: pendingStart, endSec: seconds })
    pendingStart = null
  }

  // Незакрытый silence_start — запись кончилась тишиной, ffmpeg не успел
  // напечатать конец. Диапазон без конца не диапазон, и точки реза он не даёт.
  return ranges
}

export interface SilenceCutPointOptions {
  /** Полная длина записи: по ней отбрасываются ведущая и хвостовая тишина. */
  durationSec: number
  minSilenceSec?: number
}

/**
 * Точки реза из размеченных пауз.
 *
 * Режем по СЕРЕДИНЕ паузы, а не по её краю: край означал бы, что фрагмент
 * начинается ровно на первом звуке — рот уже открыт, вступление рваное.
 * Середина оставляет запас тишины с обеих сторон, и на границах фрагмента
 * человек молчит.
 *
 * Тишина в самом начале и в самом конце записи точки реза не даёт: слева от
 * первой паузы и справа от последней резать нечего.
 */
export function silenceCutPoints(
  ranges: readonly SilenceRange[],
  options: SilenceCutPointOptions,
): number[] {
  const minSilence = options.minSilenceSec ?? 0
  const duration = options.durationSec
  const points = new Set<number>()

  for (const range of ranges) {
    if (!Number.isFinite(range.startSec) || !Number.isFinite(range.endSec)) continue
    if (range.endSec - range.startSec < minSilence) continue
    if (range.startSec <= EDGE_EPSILON_SEC) continue
    if (Number.isFinite(duration) && range.endSec >= duration - EDGE_EPSILON_SEC) continue
    points.add(round((range.startSec + range.endSec) / 2))
  }

  return [...points].sort((a, b) => a - b)
}

/** Паузы записи. Пустой список — их не нашли (или ffmpeg не смог). */
export async function detectSilenceRanges(
  videoPath: string,
  options: SilenceDetectOptions = {},
): Promise<SilenceRange[]> {
  const noiseDb = options.noiseDb ?? DEFAULT_SILENCE_NOISE_DB
  const minSilenceSec = options.minSilenceSec ?? DEFAULT_MIN_SILENCE_SEC

  const args = [
    "-hide_banner",
    "-nostats",
    "-i", videoPath,
    // Видео не трогаем вовсе: паузы слышны, а не видны.
    "-vn",
    "-af", `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`,
    "-f", "null",
    "-",
  ]

  let stderr = ""

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] })

      const timer = setTimeout(() => {
        try { proc.kill("SIGKILL") }
        catch { /* процесс уже мёртв */ }
        reject(new Error(`silence-detect: таймаут ${SILENCE_DETECT_TIMEOUT_MS / 1000}s`))
      }, SILENCE_DETECT_TIMEOUT_MS)

      proc.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      })

      proc.on("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      proc.on("close", (code) => {
        clearTimeout(timer)
        if (code !== 0) {
          reject(new Error(`silence-detect: код ${code}`))
          return
        }
        resolve()
      })
    })
  }
  catch {
    // Разбираем то, что успело прийти: у длинной записи паузы напечатаны
    // задолго до конца прогона.
  }

  return parseSilenceRangesFromStderr(stderr)
}

/** Готовые точки реза записи по речевым паузам. */
export async function detectSpeechCutPoints(
  videoPath: string,
  durationSec: number,
  options: SilenceDetectOptions = {},
): Promise<number[]> {
  const ranges = await detectSilenceRanges(videoPath, options)
  return silenceCutPoints(ranges, {
    durationSec,
    minSilenceSec: options.minSilenceSec ?? DEFAULT_MIN_SILENCE_SEC,
  })
}
