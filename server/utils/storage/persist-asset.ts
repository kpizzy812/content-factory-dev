/**
 * Загружает локальный файл в storage и возвращает blok колонок для записи
 * в VideoAsset/Video. Сохраняет паттерн "ffmpeg/native пишет в /tmp →
 * storage заливает финальный артефакт", не ломая структуру caller'а.
 *
 * Возвращает только новые storage-поля. filePath/fileUrl (legacy) caller
 * заполняет сам — обычно `localPath` для filePath и `storageKeyToLegacyUrl`
 * для fileUrl, чтобы UI без правок продолжал ходить через /api/files/.
 */
import { getStorageDriver } from "./index"

export interface AssetStorageColumns {
  storageKey: string
  storageProvider: string
  fileSizeBytes: bigint
  fileSha256: string | null
  contentType: string | null
}

export async function uploadLocalAsset(
  localPath: string,
  storageKey: string,
  contentType?: string,
): Promise<AssetStorageColumns> {
  const driver = getStorageDriver()
  const obj = await driver.uploadFile(storageKey, localPath, { contentType })
  return {
    storageKey,
    storageProvider: driver.providerName,
    fileSizeBytes: obj.sizeBytes,
    fileSha256: obj.sha256 ?? null,
    contentType: contentType ?? obj.contentType ?? null,
  }
}

/** То же но из буфера (без локального файла). */
export async function uploadBufferAsset(
  buffer: Buffer,
  storageKey: string,
  contentType?: string,
): Promise<AssetStorageColumns> {
  const driver = getStorageDriver()
  const obj = await driver.uploadBuffer(storageKey, buffer, { contentType })
  return {
    storageKey,
    storageProvider: driver.providerName,
    fileSizeBytes: obj.sizeBytes,
    fileSha256: obj.sha256 ?? null,
    contentType: contentType ?? obj.contentType ?? null,
  }
}
