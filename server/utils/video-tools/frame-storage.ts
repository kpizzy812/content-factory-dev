/**
 * Persistent storage helpers для извлечённых кадров видео.
 *
 * Layout: `<cwd>/storage/frames/<videoId>/<sequence>.jpg`.
 * В Docker `<cwd>` = `/app`, путь = `/app/storage/frames/<videoId>/<seq>.jpg`.
 * Override: env `FRAME_STORAGE_PATH` (абсолютный путь).
 *
 * В отличие от Idea-flow, который пишет кадры в `/tmp` и удаляет после анализа,
 * marketing-flow держит кадры на диске — они нужны для UI ленты VideoFrame
 * (просмотр/редактирование descriptions) и для повторных AI-прогонов без
 * скачивания исходника.
 */
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const FRAME_STORAGE_BASE = process.env.FRAME_STORAGE_PATH
  || join(process.cwd(), 'storage', 'frames')

/** Абсолютный путь к директории кадров для конкретного Video. */
export function getFrameDir(videoId: number): string {
  return join(FRAME_STORAGE_BASE, String(videoId))
}

export function getFrameStorageBase(): string {
  return FRAME_STORAGE_BASE
}

/**
 * Полностью удалить директорию кадров видео и пересоздать пустую.
 * Используется перед extractFramesParallel — гарантирует idempotency
 * (повторный прогон не оставит мусор от предыдущих numerations).
 */
export async function clearFrameDir(videoId: number): Promise<void> {
  const dir = getFrameDir(videoId)
  await rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ })
  await mkdir(dir, { recursive: true })
}

/** Создать директорию (если ещё нет) и вернуть путь. */
export async function ensureFrameDir(videoId: number): Promise<string> {
  const dir = getFrameDir(videoId)
  await mkdir(dir, { recursive: true })
  return dir
}

const DEFAULT_MAX_AGE_MS = 60 * 24 * 60 * 60_000 // 60 дней

/**
 * Cleanup helper: удаляет директории `storage/frames/<videoId>/` старше TTL.
 * Не делает ничего деструктивного без явного вызова — предполагается, что
 * scheduler/cron вызывает `wipeOldFramesByTtl()` раз в сутки.
 *
 * Возвращает количество удалённых директорий. Не падает на отдельных ошибках —
 * пропускает проблемные пути.
 */
export async function wipeOldFramesByTtl(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<{ removed: number, scanned: number }> {
  const base = FRAME_STORAGE_BASE
  let entries: string[]
  try {
    entries = await readdir(base)
  }
  catch {
    return { removed: 0, scanned: 0 }
  }

  const now = Date.now()
  let removed = 0
  let scanned = 0

  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    scanned += 1
    const fullPath = join(base, entry)
    try {
      const s = await stat(fullPath)
      if (!s.isDirectory()) continue
      if (now - s.mtimeMs > maxAgeMs) {
        await rm(fullPath, { recursive: true, force: true })
        removed += 1
      }
    }
    catch {
      // skip entry
    }
  }

  return { removed, scanned }
}
