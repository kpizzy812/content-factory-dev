/**
 * Скачивание видео в локальную tmp директорию для browser automation постинга.
 *
 * Видео живёт в GCS под Video.storageKey (zavodcamp/videos/...). Puppeteer
 * `page.setInputFiles()` требует локальный путь — поэтому каждый posting job
 * сначала скачивает файл, потом передаёт путь в poster, в finally удаляет.
 *
 * Legacy fallback: до миграции на GCS видео хранилось через filePath/fileUrl.
 * Для совместимости поддерживаем downloadVideoForPostingLegacy.
 */

import { createWriteStream, promises as fsp } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import { getStorageDriver } from "../utils/storage"

const TMP_PREFIX = "zavodcamp-posting-"
const DEFAULT_MAX_SIZE_MB = 500

export interface FetchedVideo {
  /** Полный путь к скачанному файлу. */
  localPath: string
  sizeBytes: number
  /** Обязательно вызвать в finally. Идемпотентен. */
  cleanup: () => Promise<void>
}

/**
 * Скачивает Video.storageKey в os.tmpdir() и возвращает локальный путь.
 *
 * @throws Error если файл превышает maxSizeMb или storage.downloadToFile упал.
 */
export async function downloadVideoForPosting(opts: {
  storageKey: string
  videoId: number
  maxSizeMb?: number
}): Promise<FetchedVideo> {
  const { storageKey, videoId } = opts
  const maxSizeMb = opts.maxSizeMb ?? DEFAULT_MAX_SIZE_MB
  const maxSizeBytes = maxSizeMb * 1024 * 1024

  const driver = getStorageDriver()

  // Pre-flight: проверим размер через stat. Если storage не отдаёт stat — пропускаем,
  // полагаемся на runtime check после download.
  const stat = await driver.stat(storageKey).catch(() => null)
  if (stat && stat.sizeBytes > BigInt(maxSizeBytes)) {
    throw new Error(
      `Видео #${videoId} превышает лимит ${maxSizeMb}MB (${storageKey}, ${stat.sizeBytes} bytes). ` +
        "Уменьшите видео перед постингом.",
    )
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), TMP_PREFIX))
  const safeExt = path.extname(storageKey) || ".mp4"
  const localPath = path.join(tmpDir, `video-${videoId}${safeExt}`)

  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    await driver.downloadToFile(storageKey, localPath)
  } catch (err) {
    await cleanup()
    throw new Error(
      `Не удалось скачать видео #${videoId} из storage (${storageKey}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  let sizeBytes = 0
  try {
    const st = await fsp.stat(localPath)
    sizeBytes = st.size
  } catch (err) {
    await cleanup()
    throw new Error(
      `Скачанное видео не найдено в ${localPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  if (sizeBytes > maxSizeBytes) {
    await cleanup()
    throw new Error(
      `Видео #${videoId} превышает лимит ${maxSizeMb}MB (актуальный размер ${sizeBytes} bytes).`,
    )
  }

  return { localPath, sizeBytes, cleanup }
}

/**
 * Fallback для legacy Video без storageKey. До миграции на GCS видео могло
 * храниться как fileUrl (публичный URL) или filePath (локальный путь на дисках
 * старого деплоя). Не используется для новых видео.
 */
export async function downloadVideoForPostingLegacy(opts: {
  filePath?: string | null
  fileUrl?: string | null
  videoId: number
  maxSizeMb?: number
}): Promise<FetchedVideo> {
  const { filePath, fileUrl, videoId } = opts
  const maxSizeMb = opts.maxSizeMb ?? DEFAULT_MAX_SIZE_MB
  const maxSizeBytes = maxSizeMb * 1024 * 1024

  if (!filePath && !fileUrl) {
    throw new Error(
      `Видео #${videoId} не имеет ни storageKey, ни filePath, ни fileUrl. Постинг невозможен.`,
    )
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), TMP_PREFIX))
  const ext =
    (filePath ? path.extname(filePath) : null) ||
    (fileUrl ? path.extname(new URL(fileUrl).pathname) : null) ||
    ".mp4"
  const localPath = path.join(tmpDir, `video-${videoId}${ext}`)

  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    if (filePath) {
      await fsp.copyFile(filePath, localPath)
    } else if (fileUrl) {
      const res = await fetch(fileUrl)
      if (!res.ok || !res.body) {
        throw new Error(`fileUrl fetch failed: HTTP ${res.status}`)
      }
      // Поток в файл.
      const nodeStream = Readable.fromWeb(res.body as unknown as ReadableStream<Uint8Array>)
      await pipeline(nodeStream, createWriteStream(localPath))
    }
  } catch (err) {
    await cleanup()
    throw new Error(
      `Не удалось получить legacy видео #${videoId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  let sizeBytes = 0
  try {
    const st = await fsp.stat(localPath)
    sizeBytes = st.size
  } catch (err) {
    await cleanup()
    throw new Error(
      `Скачанное legacy видео не найдено в ${localPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  if (sizeBytes > maxSizeBytes) {
    await cleanup()
    throw new Error(
      `Legacy видео #${videoId} превышает лимит ${maxSizeMb}MB (актуальный размер ${sizeBytes} bytes).`,
    )
  }

  return { localPath, sizeBytes, cleanup }
}
