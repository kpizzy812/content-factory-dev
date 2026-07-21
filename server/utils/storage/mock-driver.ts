/**
 * In-memory mock driver для unit/integration тестов. Подменяет реальный
 * GCS/local FS на Map<key, Buffer>. PrefixGuard работает идентично GCS —
 * тесты на security ловят PrefixGuard violations так же, как production.
 *
 * Использование:
 *   process.env.STORAGE_DRIVER = 'mock'
 *   const driver = getStorageDriver() // вернёт MockDriver singleton
 *
 * Очистка между тестами:
 *   resetStorageDriver()  // forget singleton; следующий getStorageDriver() даст новый MockDriver
 *   ИЛИ (driver as MockDriver).clear()
 */
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

import { assertSafeKey, assertZavodCampPrefix } from "./prefix-guard"
import {
  type SignedUrlOptions,
  type StorageDriver,
  StorageError,
  type StorageObject,
  type UploadOptions,
} from "./types"

interface MockObject {
  data: Buffer
  contentType?: string
  sha256: string
  createdAt: Date
}

export class MockDriver implements StorageDriver {
  readonly providerName = "mock" as const
  private readonly objects = new Map<string, MockObject>()

  async uploadBuffer(key: string, data: Buffer, opts?: UploadOptions): Promise<StorageObject> {
    assertZavodCampPrefix(key, "uploadBuffer")
    const sha256 = createHash("sha256").update(data).digest("hex")
    const createdAt = new Date()
    this.objects.set(key, {
      data: Buffer.from(data),
      contentType: opts?.contentType,
      sha256,
      createdAt,
    })
    return {
      key,
      sizeBytes: BigInt(data.length),
      contentType: opts?.contentType,
      sha256,
      createdAt,
    }
  }

  async uploadFile(
    key: string,
    localPath: string,
    opts?: UploadOptions,
  ): Promise<StorageObject> {
    const data = await fs.readFile(localPath)
    return this.uploadBuffer(key, data, opts)
  }

  async downloadToFile(key: string, localPath: string): Promise<void> {
    const buffer = await this.downloadToBuffer(key)
    await fs.mkdir(path.dirname(localPath), { recursive: true }).catch(() => {})
    await fs.writeFile(localPath, buffer)
  }

  async downloadToBuffer(key: string): Promise<Buffer> {
    assertSafeKey(key, "downloadToBuffer")
    const obj = this.objects.get(key)
    if (!obj) throw new StorageError(`File not found: ${key}`, "NOT_FOUND", false)
    return Buffer.from(obj.data)
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key, "exists")
    return this.objects.has(key)
  }

  async stat(key: string): Promise<StorageObject | null> {
    assertSafeKey(key, "stat")
    const obj = this.objects.get(key)
    if (!obj) return null
    return {
      key,
      sizeBytes: BigInt(obj.data.length),
      contentType: obj.contentType,
      sha256: obj.sha256,
      createdAt: obj.createdAt,
    }
  }

  async getSignedDownloadUrl(key: string, opts?: SignedUrlOptions): Promise<string> {
    assertSafeKey(key, "getSignedDownloadUrl")
    const ttl = opts?.expiresInSec ?? 3600
    return `mock://gcs/${key}?expires=${Date.now() + ttl * 1000}`
  }

  async delete(key: string): Promise<void> {
    assertZavodCampPrefix(key, "delete")
    this.objects.delete(key)
  }

  async deletePrefix(prefix: string): Promise<{ deletedCount: number }> {
    assertZavodCampPrefix(prefix, "deletePrefix")
    let count = 0
    for (const key of Array.from(this.objects.keys())) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key)
        count++
      }
    }
    return { deletedCount: count }
  }

  async list(prefix: string, opts?: { maxResults?: number }): Promise<StorageObject[]> {
    assertSafeKey(prefix, "list")
    const max = opts?.maxResults ?? Number.POSITIVE_INFINITY
    const result: StorageObject[] = []
    for (const [key, obj] of this.objects) {
      if (!key.startsWith(prefix)) continue
      result.push({
        key,
        sizeBytes: BigInt(obj.data.length),
        contentType: obj.contentType,
        sha256: obj.sha256,
        createdAt: obj.createdAt,
      })
      if (result.length >= max) break
    }
    return result
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    assertSafeKey(sourceKey, "copy (source)")
    assertZavodCampPrefix(destKey, "copy (dest)")
    const src = this.objects.get(sourceKey)
    if (!src) throw new StorageError(`File not found: ${sourceKey}`, "NOT_FOUND", false)
    this.objects.set(destKey, { ...src, data: Buffer.from(src.data), createdAt: new Date() })
  }

  clear(): void {
    this.objects.clear()
  }

  getAllKeys(): string[] {
    return Array.from(this.objects.keys())
  }
}
