/**
 * Google Cloud Storage driver. Использует @google-cloud/storage native SDK
 * (НЕ S3-совместимый AWS SDK — у GCS native клиент эффективнее работает
 * с resumable uploads и signed URLs v4). Bucket — `marketingcamp-creatives`
 * (shared с MarketingCamp), все наши файлы под префиксом `zavodcamp/`.
 *
 * Retry на 5xx/429/ETIMEDOUT/ECONNRESET — 3 попытки с exp backoff. 404 →
 * StorageError('NOT_FOUND', retryable=false). 403 — PERMISSION_DENIED,
 * не retryable (нужно править IAM).
 *
 * Signed URLs v4, TTL по умолчанию 1 час. CORS на bucket уже настроен
 * (проверено curl 2026-05-14: 200 + access-control-allow-origin).
 */
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { stat as fsStat } from "node:fs/promises"
import { pipeline } from "node:stream/promises"

import { Storage as GCSStorage, type Bucket } from "@google-cloud/storage"

import { assertSafeKey, assertZavodCampPrefix } from "./prefix-guard"
import { withRetry } from "./retry"
import {
  type SignedUrlOptions,
  type StorageDriver,
  StorageError,
  type StorageObject,
  type UploadOptions,
} from "./types"

export interface GCSDriverConfig {
  projectId: string
  bucketName: string
  /** Распаршенный service account JSON. credentials НЕ логировать. */
  credentials: object
}

const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024

export class GCSDriver implements StorageDriver {
  readonly providerName = "gcs" as const

  private readonly bucket: Bucket

  constructor(config: GCSDriverConfig) {
    const storage = new GCSStorage({
      projectId: config.projectId,
      credentials: config.credentials,
    })
    this.bucket = storage.bucket(config.bucketName)
  }

  async uploadBuffer(key: string, data: Buffer, opts?: UploadOptions): Promise<StorageObject> {
    assertZavodCampPrefix(key, "uploadBuffer")
    const sha256 = createHash("sha256").update(data).digest("hex")

    return withRetry(`gcs.uploadBuffer(${key})`, async () => {
      const file = this.bucket.file(key)
      await file.save(data, {
        contentType: opts?.contentType,
        metadata: {
          cacheControl: opts?.cacheControl,
          metadata: { ...opts?.metadata, sha256 },
        },
        resumable: false,
      })
      return {
        key,
        sizeBytes: BigInt(data.length),
        contentType: opts?.contentType,
        sha256,
        createdAt: new Date(),
      }
    })
  }

  async uploadFile(
    key: string,
    localPath: string,
    opts?: UploadOptions,
  ): Promise<StorageObject> {
    assertZavodCampPrefix(key, "uploadFile")

    return withRetry(`gcs.uploadFile(${key})`, async () => {
      const stat = await fsStat(localPath)
      const hash = createHash("sha256")
      const readStream = createReadStream(localPath)
      readStream.on("data", (chunk) => hash.update(chunk))

      const file = this.bucket.file(key)
      const writeStream = file.createWriteStream({
        contentType: opts?.contentType,
        metadata: {
          cacheControl: opts?.cacheControl,
          metadata: opts?.metadata,
        },
        resumable: stat.size > RESUMABLE_THRESHOLD_BYTES,
      })

      await pipeline(readStream, writeStream)
      const sha256 = hash.digest("hex")

      // Дописываем sha256 в metadata отдельным запросом — SDK не даёт
      // вычислить хэш во время stream'a и положить в headers.
      await file.setMetadata({
        metadata: { ...opts?.metadata, sha256 },
      })

      return {
        key,
        sizeBytes: BigInt(stat.size),
        contentType: opts?.contentType,
        sha256,
        createdAt: new Date(),
      }
    })
  }

  async downloadToFile(key: string, localPath: string): Promise<void> {
    assertSafeKey(key, "downloadToFile")

    return withRetry(`gcs.downloadToFile(${key})`, async () => {
      const file = this.bucket.file(key)
      const readStream = file.createReadStream()
      const writeStream = createWriteStream(localPath)
      try {
        await pipeline(readStream, writeStream)
      } catch (err) {
        if (this.is404(err)) {
          throw new StorageError(`File not found: ${key}`, "NOT_FOUND", false, err)
        }
        throw err
      }
    })
  }

  async downloadToBuffer(key: string): Promise<Buffer> {
    assertSafeKey(key, "downloadToBuffer")

    return withRetry(`gcs.downloadToBuffer(${key})`, async () => {
      try {
        const [buffer] = await this.bucket.file(key).download()
        return buffer
      } catch (err) {
        if (this.is404(err)) {
          throw new StorageError(`File not found: ${key}`, "NOT_FOUND", false, err)
        }
        throw err
      }
    })
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key, "exists")
    return withRetry(`gcs.exists(${key})`, async () => {
      const [exists] = await this.bucket.file(key).exists()
      return exists
    })
  }

  async stat(key: string): Promise<StorageObject | null> {
    assertSafeKey(key, "stat")
    return withRetry(`gcs.stat(${key})`, async () => {
      try {
        const [metadata] = await this.bucket.file(key).getMetadata()
        const customMeta = (metadata.metadata as Record<string, string> | undefined) ?? {}
        return {
          key,
          sizeBytes: BigInt(metadata.size ?? 0),
          contentType: metadata.contentType,
          sha256: customMeta.sha256,
          createdAt: metadata.timeCreated ? new Date(metadata.timeCreated) : undefined,
        }
      } catch (err) {
        if (this.is404(err)) return null
        throw err
      }
    })
  }

  async getSignedDownloadUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    assertSafeKey(key, "getSignedDownloadUrl")
    const expiresInSec = opts?.expiresInSec ?? 3600

    return withRetry(`gcs.signUrl(${key})`, async () => {
      const [url] = await this.bucket.file(key).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + expiresInSec * 1000,
        responseDisposition: opts?.responseDisposition,
        responseType: opts?.responseContentType,
      })
      return url
    })
  }

  async delete(key: string): Promise<void> {
    assertZavodCampPrefix(key, "delete")
    return withRetry(`gcs.delete(${key})`, async () => {
      try {
        await this.bucket.file(key).delete()
      } catch (err) {
        if (this.is404(err)) return
        throw err
      }
    })
  }

  async deletePrefix(prefix: string): Promise<{ deletedCount: number }> {
    assertZavodCampPrefix(prefix, "deletePrefix")
    return withRetry(`gcs.deletePrefix(${prefix})`, async () => {
      const [files] = await this.bucket.getFiles({ prefix })
      let deletedCount = 0
      const batchSize = 50
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        await Promise.all(
          batch.map((f) =>
            f.delete().catch((err) => {
              if (!this.is404(err)) throw err
            }),
          ),
        )
        deletedCount += batch.length
      }
      return { deletedCount }
    })
  }

  async list(prefix: string, opts?: { maxResults?: number }): Promise<StorageObject[]> {
    assertSafeKey(prefix, "list")
    return withRetry(`gcs.list(${prefix})`, async () => {
      const [files] = await this.bucket.getFiles({
        prefix,
        maxResults: opts?.maxResults,
      })
      return files.map((f) => ({
        key: f.name,
        sizeBytes: BigInt(f.metadata.size ?? 0),
        contentType: f.metadata.contentType,
        createdAt: f.metadata.timeCreated ? new Date(f.metadata.timeCreated) : undefined,
      }))
    })
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    assertSafeKey(sourceKey, "copy (source)")
    assertZavodCampPrefix(destKey, "copy (dest)")
    return withRetry(`gcs.copy(${sourceKey} -> ${destKey})`, async () => {
      await this.bucket.file(sourceKey).copy(this.bucket.file(destKey))
    })
  }

  private is404(err: unknown): boolean {
    if (!err || typeof err !== "object") return false
    const e = err as { code?: number | string; status?: number; statusCode?: number }
    if (e.code === 404 || e.code === "404") return true
    if (e.status === 404 || e.statusCode === 404) return true
    return false
  }
}
