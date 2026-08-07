/**
 * ffmpeg-адаптер контура похожести: сырые кадры готового ролика → dHash.
 *
 * ПОЧЕМУ отдельным модулем: это единственное место контура, где запускается
 * процесс. Вся логика (какие точки снимать, как сравнивать, что считать дублем)
 * живёт в `video-fingerprint.ts` и проверяется тестом без ffmpeg.
 *
 * ПОЧЕМУ не переиспользуем `presenter/ffmpeg-adapter.ts`: там `grayscaleThumbnail`
 * умеет брать только первый кадр файла, а нам нужны три точки по таймлайну.
 * Сам dHash при этом взят оттуда же — `presenter/perceptual-hash.ts`, второго
 * алгоритма в проекте не появляется.
 */

import { spawn } from 'node:child_process'

import {
  DHASH_HEIGHT,
  DHASH_WIDTH,
  dHashFromGrayscale,
} from '../presenter/perceptual-hash'
import type { FingerprintFrame, FingerprintTimestamp } from './video-fingerprint'

const FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || 'ffmpeg'
const FRAME_TIMEOUT_MS = 60_000
const EXPECTED_BYTES = DHASH_WIDTH * DHASH_HEIGHT

function runFfmpegCapture(args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let stderr = ''

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') }
      catch { /* процесс уже мёртв */ }
      reject(new Error(`ffmpeg: таймаут ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    proc.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`ffmpeg завершился с кодом ${code}: ${stderr.slice(-400)}`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
  })
}

/**
 * Сырые 9x8 серых пикселей прямо в stdout — так не нужен декодер изображений
 * ради одного кадра. `-ss` перед `-i` даёт быстрый seek по ключевым кадрам:
 * точность до кадра здесь не нужна, отпечаток и так строится с отступом от краёв.
 */
async function grayscaleAt(filePath: string, atSec: number | null): Promise<Uint8Array> {
  const args = ['-hide_banner', '-nostats']
  if (atSec !== null) args.push('-ss', atSec.toFixed(2))
  args.push(
    '-i', filePath,
    '-frames:v', '1',
    '-an', '-sn',
    '-vf', `scale=${DHASH_WIDTH}:${DHASH_HEIGHT}:flags=area,format=gray`,
    '-f', 'rawvideo',
    '-',
  )
  const stdout = await runFfmpegCapture(args, FRAME_TIMEOUT_MS)
  if (stdout.length < EXPECTED_BYTES) {
    throw new Error(
      `ffmpeg вернул ${stdout.length} байт вместо ${EXPECTED_BYTES} для кадра ${DHASH_WIDTH}x${DHASH_HEIGHT}`,
    )
  }
  return new Uint8Array(stdout.subarray(0, EXPECTED_BYTES))
}

export interface FrameHashResult {
  frames: FingerprintFrame[]
  /** Точки, которые ffmpeg не отдал. Отпечаток из двух кадров лучше, чем ничего. */
  errors: string[]
}

/**
 * Хеши кадров в заданных точках. Одна неудачная точка не роняет остальные:
 * решение «отпечаток непригоден» принимает вызывающий код, увидев пустой список.
 */
export async function hashVideoFrames(
  filePath: string,
  timestamps: FingerprintTimestamp[],
): Promise<FrameHashResult> {
  const frames: FingerprintFrame[] = []
  const errors: string[] = []
  for (const point of timestamps) {
    try {
      const pixels = await grayscaleAt(filePath, point.atSec)
      frames.push({ label: point.label, atSec: point.atSec, hash: dHashFromGrayscale(pixels) })
    }
    catch (error) {
      errors.push(`${point.label}@${point.atSec}s: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { frames, errors }
}

/** Хеш обложки. ffmpeg читает картинку тем же путём, что и видео. */
export async function hashImageFile(filePath: string): Promise<string> {
  return dHashFromGrayscale(await grayscaleAt(filePath, null))
}
