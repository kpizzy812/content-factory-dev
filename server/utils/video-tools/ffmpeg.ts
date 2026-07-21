/**
 * ffmpeg/ffprobe утилиты — извлечение длительности, кадров и аудио из локальных видео-файлов.
 *
 * Использует уже установленный fluent-ffmpeg. Бинарь ffmpeg должен быть в PATH.
 * Опциональный override через env FFMPEG_PATH (применяется при первом импорте).
 */

import ffmpeg from 'fluent-ffmpeg'
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExtractedFrameRich, PickedTimestamp } from './frame-types'

if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.trim().length > 0) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH)
}
if (process.env.FFPROBE_PATH && process.env.FFPROBE_PATH.trim().length > 0) {
  ffmpeg.setFfprobePath(process.env.FFPROBE_PATH)
}

function describeSubprocessError(err: unknown): string {
  if (err === null || err === undefined) return `(${err === null ? 'null' : 'undefined'} error)`
  if (typeof err !== 'object') return `[${typeof err}] ${String(err)}`

  const e = err as Record<string, unknown>
  const parts: string[] = []

  const ctor = (err as object).constructor?.name
  if (ctor && ctor !== 'Object' && ctor !== 'Error') parts.push(`type=${ctor}`)

  const short = typeof e.shortMessage === 'string' ? e.shortMessage.trim() : ''
  const message = typeof e.message === 'string' ? e.message.trim() : ''
  if (short) parts.push(short)
  if (message && message !== short) parts.push(message)
  if (typeof e.code === 'string') parts.push(`code=${e.code}`)
  if (typeof e.exitCode === 'number') parts.push(`exitCode=${e.exitCode}`)
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : ''
  if (stderr) parts.push(`stderr: ${stderr.slice(0, 1500)}`)
  const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : ''
  if (!stderr && stdout) parts.push(`stdout: ${stdout.slice(0, 500)}`)

  if (parts.length === 0) {
    const keys = Object.keys(e)
    if (keys.length > 0) {
      const dump = keys.slice(0, 10).map(k => `${k}=${JSON.stringify(e[k])?.slice(0, 100) || 'undefined'}`).join(', ')
      parts.push(`keys: ${dump}`)
    }
    else {
      parts.push(`(empty error object, prototype=${Object.prototype.toString.call(err)})`)
    }
  }

  if (typeof e.stack === 'string' && parts.length < 3) {
    parts.push(`stack: ${e.stack.split('\n').slice(0, 4).join(' | ')}`)
  }

  return parts.join(' | ')
}

function wrapBinaryError(err: unknown): never {
  const msg = describeSubprocessError(err)
  if (/ENOENT|spawn ffmpeg|spawn ffprobe|not found/i.test(msg)) {
    throw new Error(
      `ffmpeg/ffprobe бинарь не найден. Установите: apt-get install ffmpeg. `
      + `Опционально укажите путь через env FFMPEG_PATH/FFPROBE_PATH. Original: ${msg}`,
    )
  }
  throw new Error(`ffmpeg ошибка: ${msg}`)
}

/** Получить длительность видео в секундах через ffprobe. */
export function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        try { wrapBinaryError(err) }
        catch (wrapped) { reject(wrapped); return }
      }
      const duration = metadata?.format?.duration
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        resolve(duration)
      }
      else {
        resolve(0)
      }
    })
  })
}

export interface ExtractedFrameFile {
  index: number
  filePath: string
  timestampSec: number
  bytes: number
}

/**
 * Извлечь N кадров равномерно по timeline в outputDir.
 * Расположение timestamps: duration*i/(count+1) для i=1..count — кадры не на самых краях.
 * Для видео ≤1с возвращает один кадр посередине без ошибки.
 */
export async function extractFramesFfmpeg(
  videoPath: string,
  count: number,
  outputDir: string,
  width: number = 720,
): Promise<ExtractedFrameFile[]> {
  await mkdir(outputDir, { recursive: true })

  const duration = await getVideoDuration(videoPath)
  if (!duration || duration <= 0) {
    throw new Error(`ffmpeg: длительность видео определить не удалось (${videoPath})`)
  }

  // Если совсем короткое — один кадр посередине
  const effectiveCount = duration <= 1 ? 1 : Math.max(1, count)

  const timestamps: number[] = []
  for (let i = 1; i <= effectiveCount; i++) {
    timestamps.push(Number(((duration * i) / (effectiveCount + 1)).toFixed(2)))
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .on('error', (err) => {
        try { wrapBinaryError(err) }
        catch (wrapped) { reject(wrapped); return }
        reject(err)
      })
      .on('end', () => resolve())
      .screenshots({
        timestamps,
        filename: 'frame-%i.jpg',
        folder: outputDir,
        size: `${width}x?`,
      })
  })

  // Собрать реальные frame-N.jpg (fluent-ffmpeg именует frame-1.jpg ... frame-N.jpg)
  const entries = await readdir(outputDir)
  const frames: ExtractedFrameFile[] = []
  for (let i = 1; i <= effectiveCount; i++) {
    const candidate = entries.find(e => e === `frame-${i}.jpg`)
    if (!candidate) continue
    const fullPath = join(outputDir, candidate)
    const fStat = await stat(fullPath).catch(() => null)
    if (!fStat) continue
    frames.push({
      index: i - 1,
      filePath: fullPath,
      timestampSec: timestamps[i - 1] || 0,
      bytes: fStat.size,
    })
  }

  if (frames.length === 0) {
    throw new Error('ffmpeg: ни один кадр не извлечён (screenshots вернул пустой список)')
  }

  return frames
}

// ─── Parallel frame extraction (Этап 2 модернизации Video Analyzer) ────────
//
// Эти утилиты используются новым marketing-grade `analyzeCreativeVideo`
// orchestrator. Они НЕ заменяют `extractFramesFfmpeg` (который остаётся для
// Idea/reference flow и работает через fluent-ffmpeg `screenshots`).
//
// Принципиальные отличия от `extractFramesFfmpeg`:
//   - принимает явный список `PickedTimestamp` (а не равномерное N) — caller
//     уже сделал adaptive count + scene snap;
//   - параллельные вызовы ffmpeg (4 воркера) для скорости;
//   - per-frame timeout с SIGKILL вместо общего timeout всего batch;
//   - downscale-fallback при oversize (>5MB → re-extract на 720p q:v=5);
//   - именование `<sequence>.jpg` (а не `frame-%i.jpg`);
//   - использует `child_process.spawn` напрямую — fluent-ffmpeg при параллельном
//     запуске даёт нестабильный результат с `-ss after -i` (нужный нам
//     pixel-accurate seek).

const FRAME_FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || 'ffmpeg'

export interface ExtractFramesParallelOptions {
  /** Ширина scale=W:-2 (default 1024). */
  width?: number
  /** ffmpeg `-q:v` 1..31 (default 2 — высокое качество для AI). */
  quality?: number
  /** Воркеров ffmpeg (default 4). */
  maxParallel?: number
  /** Per-frame timeout SIGKILL (default 30s). */
  perFrameTimeoutMs?: number
  /** Включить retry с downscale если jpg вышел >threshold (default true). */
  downscaleOnOversize?: boolean
  /** Threshold для downscale-trigger (default 5MB). */
  oversizeThresholdBytes?: number
  /** Width для re-extract при downscale (default 720). */
  fallbackWidth?: number
  /** Quality для re-extract при downscale (default 5). */
  fallbackQuality?: number
}

const FRAME_DEFAULTS = {
  width: 1024,
  quality: 2,
  maxParallel: 4,
  perFrameTimeoutMs: 30_000,
  downscaleOnOversize: true,
  oversizeThresholdBytes: 5 * 1024 * 1024,
  fallbackWidth: 720,
  fallbackQuality: 5,
} as const

interface ExtractOneParams {
  inputPath: string
  outputPath: string
  timestampSec: number
  width: number
  quality: number
  timeoutMs: number
}

async function extractOneFrameSpawn(opts: ExtractOneParams): Promise<void> {
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(opts.timestampSec),
    '-i',
    opts.inputPath,
    '-frames:v',
    '1',
    '-q:v',
    String(opts.quality),
    '-vf',
    `scale=${opts.width}:-2`,
    opts.outputPath,
  ]

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FRAME_FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') }
      catch { /* ignore */ }
      reject(new Error(`ffmpeg extract: timeout @${opts.timestampSec}s`))
    }, opts.timeoutMs)

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`ffmpeg extract: spawn failed (${err.message})`))
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`ffmpeg extract: exit ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      resolve()
    })
  })
}

async function runWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = items.map((item, index) => ({ item, index }))
  const workers: Promise<void>[] = []
  const workerCount = Math.min(limit, queue.length)
  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      while (queue.length) {
        const next = queue.shift()
        if (!next) return
        await fn(next.item, next.index)
      }
    })())
  }
  await Promise.all(workers)
}

/**
 * Параллельно извлечь кадры в указанные timestamps.
 *
 * Поведение при ошибках per-frame: одна неудача (timeout, exit !=0) не валит
 * весь batch — просто этот кадр не попадает в результат. Caller (orchestrator)
 * проверяет `result.length` против `expected.length` и решает, считать ли это
 * фатальным или продолжить.
 *
 * Downscale fallback: после успешного extract проверяем размер jpg; если он
 * выше `oversizeThresholdBytes` — пере-извлекаем в тот же путь с меньшим
 * `width`/`quality` (оверврайт `-y`). Это защита от 4K-видео с тяжёлыми
 * jpeg, которые раздуют payload в Anthropic.
 */
export async function extractFramesParallel(
  videoPath: string,
  timestamps: PickedTimestamp[],
  outputDir: string,
  options: ExtractFramesParallelOptions = {},
): Promise<ExtractedFrameRich[]> {
  if (timestamps.length === 0) return []

  const width = options.width ?? FRAME_DEFAULTS.width
  const quality = options.quality ?? FRAME_DEFAULTS.quality
  const maxParallel = options.maxParallel ?? FRAME_DEFAULTS.maxParallel
  const perFrameTimeoutMs = options.perFrameTimeoutMs ?? FRAME_DEFAULTS.perFrameTimeoutMs
  const downscaleOnOversize = options.downscaleOnOversize ?? FRAME_DEFAULTS.downscaleOnOversize
  const oversizeThresholdBytes = options.oversizeThresholdBytes ?? FRAME_DEFAULTS.oversizeThresholdBytes
  const fallbackWidth = options.fallbackWidth ?? FRAME_DEFAULTS.fallbackWidth
  const fallbackQuality = options.fallbackQuality ?? FRAME_DEFAULTS.fallbackQuality

  await mkdir(outputDir, { recursive: true })

  const sorted = [...timestamps].sort((a, b) => a.sequence - b.sequence)
  const slots: (ExtractedFrameRich | null)[] = new Array(sorted.length).fill(null)

  await runWithLimit(sorted, maxParallel, async (ts, idx) => {
    const outputPath = join(outputDir, `${ts.sequence}.jpg`)
    try {
      await extractOneFrameSpawn({
        inputPath: videoPath,
        outputPath,
        timestampSec: ts.timestampSec,
        width,
        quality,
        timeoutMs: perFrameTimeoutMs,
      })
    }
    catch {
      // одна неудача не валит всю операцию
      return
    }

    let size = 0
    let effectiveWidth: number | null = width
    try {
      const s = await stat(outputPath)
      size = s.size
    }
    catch {
      return
    }

    if (downscaleOnOversize && size > oversizeThresholdBytes) {
      try {
        await extractOneFrameSpawn({
          inputPath: videoPath,
          outputPath,
          timestampSec: ts.timestampSec,
          width: fallbackWidth,
          quality: fallbackQuality,
          timeoutMs: perFrameTimeoutMs,
        })
        const s2 = await stat(outputPath)
        size = s2.size
        effectiveWidth = fallbackWidth
      }
      catch {
        // оставляем как есть с oversize
      }
    }

    slots[idx] = {
      sequence: ts.sequence,
      timestampSec: ts.timestampSec,
      filePath: outputPath,
      bytes: size,
      width: effectiveWidth,
      height: null,
      isSceneBoundary: ts.isSceneBoundary,
    }
  })

  return slots.filter((s): s is ExtractedFrameRich => s !== null)
}

/**
 * Извлечь аудиодорожку как mp3 (libmp3lame, 64kbps) для отправки в Whisper.
 */
export function extractAudioMp3(videoPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .noVideo()
      .format('mp3')
      .on('error', (err) => {
        try { wrapBinaryError(err) }
        catch (wrapped) { reject(wrapped); return }
        reject(err)
      })
      .on('end', () => resolve())
      .save(outPath)
  })
}
