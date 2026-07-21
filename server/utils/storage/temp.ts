/**
 * Helpers для временных файлов вне persistent storage. ffmpeg, yt-dlp и
 * прочие native-инструменты требуют локальные пути — для них нужен
 * scratchpad в /tmp с гарантированным cleanup.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * Создаёт временную директорию в /tmp с префиксом, передаёт путь в callback,
 * чистит после завершения (даже при ошибке).
 */
export async function withTempDir<T>(
  prefix: string,
  fn: (dirPath: string) => Promise<T>,
): Promise<T> {
  const dirPath = await mkdtemp(path.join(tmpdir(), `zc-${prefix}-`))
  try {
    return await fn(dirPath)
  } finally {
    await rm(dirPath, { recursive: true, force: true }).catch((err) => {
      console.warn(`[storage] failed to cleanup temp dir ${dirPath}:`, err)
    })
  }
}
