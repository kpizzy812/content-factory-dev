/**
 * Scene boundary detection через `ffmpeg -vf select=gt(scene,T),showinfo`.
 *
 * Best-effort: при любых ошибках (timeout, non-zero exit, ENOENT) возвращаем
 * пустой массив — caller (`pickTimestamps`) тогда работает в режиме равномерных
 * интервалов без snap.
 *
 * Парсинг: stderr ffmpeg содержит строки `[Parsed_showinfo_*] ... pts_time:N.NNNN ...`
 * для каждого кадра проходящего фильтр `select=gt(scene,T)`. Берём regex по
 * `pts_time:([0-9]+(?:\.[0-9]+)?)`, dedup, sort asc, round 2 знака.
 *
 * Порт из MarketingCamp `server/utils/video/scene-detect.ts`.
 */
import { spawn } from 'node:child_process'
import type { SceneBoundary } from './frame-types'

const FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || 'ffmpeg'
const SCENE_DETECT_TIMEOUT_MS = 5 * 60_000

/**
 * Обнаружить scene boundaries в видео.
 * @param videoPath абсолютный путь к видео-файлу
 * @param threshold сценочувствительность 0..1 (default 0.4 — баланс
 *                  precision/recall, как в MC)
 */
export async function detectSceneBoundaries(
  videoPath: string,
  threshold: number = 0.4,
): Promise<SceneBoundary[]> {
  const args = [
    '-hide_banner',
    '-nostats',
    '-i',
    videoPath,
    '-vf',
    `select='gt(scene,${threshold})',showinfo`,
    '-f',
    'null',
    '-',
  ]

  let stderr = ''

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })

      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL') }
        catch { /* ignore */ }
        reject(new Error(`scene-detect: timeout ${SCENE_DETECT_TIMEOUT_MS / 1000}s`))
      }, SCENE_DETECT_TIMEOUT_MS)

      proc.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      proc.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) {
          // Non-zero — но stderr с pts_time мог успеть наполниться, пробуем парсить
          reject(new Error(`scene-detect: exit ${code}`))
          return
        }
        resolve()
      })
    })
  }
  catch {
    // best-effort: даже если процесс упал/timeout — пытаемся вытащить из stderr
    // что успело прийти. Для пустого stderr regex не найдёт ничего → [].
  }

  return parseSceneBoundariesFromStderr(stderr)
}

/** Внутренний парсер stderr — экспортируется для unit-тестирования. */
export function parseSceneBoundariesFromStderr(stderr: string): SceneBoundary[] {
  const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g
  const seen = new Set<number>()
  const result: SceneBoundary[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(stderr)) !== null) {
    const raw = Number.parseFloat(match[1])
    if (!Number.isFinite(raw)) continue
    const rounded = Math.round(raw * 100) / 100
    if (seen.has(rounded)) continue
    seen.add(rounded)
    result.push({ timestampSec: rounded })
  }
  result.sort((a, b) => a.timestampSec - b.timestampSec)
  return result
}
