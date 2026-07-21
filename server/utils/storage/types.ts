/**
 * Контракт storage-драйверов. Один интерфейс на три имплементации:
 * GCSDriver (prod), LocalDriver (dev/legacy ./storage), MockDriver (tests).
 *
 * Драйвер выбирается фабрикой `getStorageDriver()` через env `STORAGE_DRIVER`.
 * Все обращения к файлам в проекте должны идти через этот интерфейс,
 * мимо прямых fs/fetch вызовов — иначе теряется PrefixGuard и retry.
 */

export type StorageProvider = "gcs" | "local" | "mock" | "missing"

/** Описание объекта в storage (после upload/stat). */
export interface StorageObject {
  /** Полный ключ. Для записи всегда начинается с `zavodcamp/`. */
  key: string
  sizeBytes: bigint
  contentType?: string
  /** SHA-256 контента (lowercase hex). Заполняется при upload, у GCS stat может отсутствовать у старых объектов. */
  sha256?: string
  createdAt?: Date
}

export interface UploadOptions {
  contentType?: string
  /** Например, `public, max-age=3600` для thumbnails. По умолчанию приватный объект без CDN. */
  cacheControl?: string
  /** Произвольные ключи в metadata. SHA-256 кладётся отдельно — не дублировать. */
  metadata?: Record<string, string>
}

export interface SignedUrlOptions {
  expiresInSec?: number
  responseDisposition?: string
  responseContentType?: string
}

/**
 * Все методы идемпотентны там, где это уместно: повторный delete не падает,
 * повторный upload перезаписывает. Write/delete ВСЕГДА проходят через
 * PrefixGuard — попытка вне `zavodcamp/` бросает StorageError('PREFIX_GUARD').
 */
export interface StorageDriver {
  readonly providerName: StorageProvider

  uploadBuffer(key: string, data: Buffer, opts?: UploadOptions): Promise<StorageObject>
  uploadFile(key: string, localPath: string, opts?: UploadOptions): Promise<StorageObject>

  downloadToFile(key: string, localPath: string): Promise<void>
  downloadToBuffer(key: string): Promise<Buffer>

  exists(key: string): Promise<boolean>
  stat(key: string): Promise<StorageObject | null>

  /** TTL по умолчанию 3600 секунд. */
  getSignedDownloadUrl(key: string, opts?: SignedUrlOptions): Promise<string>

  delete(key: string): Promise<void>
  /** Удаление по префиксу. PrefixGuard ловит попытки вне `zavodcamp/`. */
  deletePrefix(prefix: string): Promise<{ deletedCount: number }>

  list(prefix: string, opts?: { maxResults?: number }): Promise<StorageObject[]>

  /** Копирование внутри bucket. dest всегда валидируется PrefixGuard'ом. */
  copy(sourceKey: string, destKey: string): Promise<void>
}

export type StorageErrorCode =
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "NETWORK"
  | "PREFIX_GUARD"
  | "INVALID_KEY"
  | "UNKNOWN"

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: StorageErrorCode,
    public readonly retryable: boolean,
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = "StorageError"
  }
}
