/**
 * yt-dlp wrapper утилиты — скачивание видео и извлечение subtitle-треков.
 *
 * Использует npm-пакет `youtube-dl-exec` (spawn-обёртка над yt-dlp бинарём).
 * Требования к окружению: yt-dlp в PATH (или python с pip yt-dlp).
 * Опциональный override через env YT_DLP_BIN_PATH.
 */

import { readdir, stat, access } from 'node:fs/promises'
import { join } from 'node:path'
import { constants as fsConstants } from 'node:fs'
import youtubeDl, { create as createYoutubeDl } from 'youtube-dl-exec'

let cachedRunner: typeof youtubeDl | null = null

/** Кандидаты путей к yt-dlp если postinstall библиотеки не отработал (типично для Bun). */
const SYSTEM_YT_DLP_CANDIDATES = ['/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/opt/homebrew/bin/yt-dlp']

async function findSystemYtDlp(): Promise<string | null> {
  for (const candidate of SYSTEM_YT_DLP_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    }
    catch { /* try next */ }
  }
  return null
}

/**
 * Возвращает экземпляр youtube-dl-exec.
 * Приоритет:
 *  1. env YT_DLP_BIN_PATH (явный override)
 *  2. системный yt-dlp в PATH (если он есть в типичных местах)
 *  3. дефолтный youtubeDl (использует прибитый библиотекой бинарь — может отсутствовать после bun install)
 */
async function getRunner(): Promise<typeof youtubeDl> {
  if (cachedRunner) return cachedRunner
  const overridePath = process.env.YT_DLP_BIN_PATH?.trim()
  if (overridePath && overridePath.length > 0) {
    cachedRunner = createYoutubeDl(overridePath) as typeof youtubeDl
    return cachedRunner
  }
  const systemPath = await findSystemYtDlp()
  if (systemPath) {
    cachedRunner = createYoutubeDl(systemPath) as typeof youtubeDl
    return cachedRunner
  }
  cachedRunner = youtubeDl
  return cachedRunner
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
  if (typeof e.signal === 'string') parts.push(`signal=${e.signal}`)
  if (typeof e.command === 'string') parts.push(`command=${e.command.slice(0, 200)}`)
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : ''
  if (stderr) parts.push(`stderr: ${stderr.slice(0, 1500)}`)
  const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : ''
  if (!stderr && stdout) parts.push(`stdout: ${stdout.slice(0, 500)}`)

  // Если объект пустой — дамп всех enumerable ключей чтобы видеть структуру
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

function isBinaryNotFound(err: unknown): boolean {
  const msg = describeSubprocessError(err)
  return /ENOENT|spawn .*ENOENT|not found/i.test(msg)
}

function wrapBinaryError(err: unknown): never {
  const original = describeSubprocessError(err)
  if (isBinaryNotFound(err)) {
    throw new Error(
      `yt-dlp бинарь не найден. Установите его: apt-get install yt-dlp ИЛИ pip install yt-dlp. `
      + `Опционально укажите путь через env YT_DLP_BIN_PATH. Original: ${original}`,
    )
  }
  throw new Error(`yt-dlp ошибка: ${original}`)
}

/** Низкоуровневый вызов yt-dlp с произвольными опциями (output как объект youtube-dl-exec) */
export async function runYtDlp(
  url: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  const runner = await getRunner()
  try {
    return await runner(url, options as never)
  }
  catch (err) {
    wrapBinaryError(err)
  }
}

export interface YtDlpDownloadResult {
  /** Полный путь до скачанного файла на диске */
  filePath: string
  /** Размер в байтах */
  bytes: number
  /** Длительность в секундах если удалось вытащить из metadata */
  durationSec: number | null
  /** Расширение реального файла (mp4, webm, ...) */
  resolvedFormat: string
}

/**
 * Скачать видео в outputDir под именем `source.<ext>`.
 * Сначала dump-single-json для метаданных (длительность, ext), потом сам download.
 */
export async function downloadVideoYtDlp(
  url: string,
  outputDir: string,
): Promise<YtDlpDownloadResult> {
  const runner = await getRunner()

  // Шаг 1 — метаданные без скачивания
  let durationSec: number | null = null
  try {
    const metaRaw = await runner(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      noPlaylist: true,
    } as never)
    durationSec = parseDurationFromYtDlpJson(metaRaw)
  }
  catch (err) {
    if (isBinaryNotFound(err)) wrapBinaryError(err)
    // Метаданные не критичны — могли не дать, продолжаем download
  }

  // Шаг 2 — собственно download
  const outputTemplate = join(outputDir, 'source.%(ext)s')
  try {
    await runner(url, {
      output: outputTemplate,
      format: 'best[height<=720][ext=mp4]/best[height<=720]/best',
      noCheckCertificates: true,
      noPlaylist: true,
      noWarnings: true,
    } as never)
  }
  catch (err) {
    wrapBinaryError(err)
  }

  // Шаг 3 — найти реальный файл (расширение определит yt-dlp)
  const entries = await readdir(outputDir)
  const candidate = entries.find(e => e.startsWith('source.') && !e.endsWith('.json'))
  if (!candidate) {
    throw new Error('yt-dlp не создал файл source.* в выходной директории')
  }
  const filePath = join(outputDir, candidate)
  const fileStat = await stat(filePath)
  const ext = candidate.split('.').pop() || 'mp4'

  return {
    filePath,
    bytes: fileStat.size,
    durationSec,
    resolvedFormat: ext,
  }
}

/**
 * Извлечь auto-subs (или native subs) через yt-dlp без скачивания видео.
 * Возвращает путь к найденному .vtt-файлу или null.
 */
export async function extractCaptionsViaYtDlp(
  url: string,
  outputDir: string,
  langs: string[] = ['ru', 'en'],
): Promise<{ filePath: string; lang: string } | null> {
  const runner = await getRunner()
  const subFile = join(outputDir, 'captions')

  try {
    await runner(url, {
      output: `${subFile}.%(ext)s`,
      writeAutoSub: true,
      writeSub: true,
      skipDownload: true,
      subLang: langs.join(','),
      subFormat: 'vtt',
      noCheckCertificates: true,
      noPlaylist: true,
      noWarnings: true,
    } as never)
  }
  catch (err) {
    if (isBinaryNotFound(err)) wrapBinaryError(err)
    return null
  }

  // Ищем результат: captions.<lang>.vtt
  const entries = await readdir(outputDir).catch(() => [])
  for (const lang of langs) {
    const found = entries.find(e => e.startsWith('captions.') && e.endsWith('.vtt') && e.includes(`.${lang}.`))
    if (found) return { filePath: join(outputDir, found), lang }
  }
  // fallback — любой captions.*.vtt
  const anyVtt = entries.find(e => e.startsWith('captions.') && e.endsWith('.vtt'))
  if (anyVtt) {
    const langMatch = anyVtt.match(/captions\.([a-z-]+)\.vtt/i)
    return { filePath: join(outputDir, anyVtt), lang: langMatch?.[1] || 'unknown' }
  }
  return null
}

/** Достать длительность (в секундах) из dumpSingleJson-объекта yt-dlp. */
export function parseDurationFromYtDlpJson(meta: unknown): number | null {
  if (!meta || typeof meta !== 'object') return null
  const obj = meta as Record<string, unknown>
  if (typeof obj.duration === 'number') return obj.duration
  if (typeof obj.duration === 'string') {
    const parsed = Number(obj.duration)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
