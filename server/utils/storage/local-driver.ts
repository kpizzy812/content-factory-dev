/**
 * Driver для локального dev FS. Ключ `zavodcamp/videos/65/final.mp4`
 * мапится в `{rootDir}/zavodcamp/videos/65/final.mp4`. Под капотом
 * fs/promises + streams, никаких сетевых вызовов — instant feedback.
 *
 * Корень настраивается через STORAGE_LOCAL_ROOT (alias к существующему
 * UPLOADS_STORAGE_PATH — см. factory). Default `./storage` от cwd.
 *
 * Signed URLs в dev — это просто `/api/files/{encoded-key}`, файлы
 * раздаёт server/api/files/[...path].get.ts (после миграции его behavior).
 */
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream, existsSync } from "node:fs"
import { promises as fs } from "node:fs"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import { assertSafeKey, assertZavodCampPrefix } from "./prefix-guard"
import {
  type SignedUrlOptions,
  type StorageDriver,
  StorageError,
  type StorageObject,
  type UploadOptions,
} from "./types"

export interface LocalDriverConfig {
  rootDir: string
}

export class LocalDriver implements StorageDriver {
  readonly providerName = "local" as const
  private readonly rootDir: string

  constructor(config: LocalDriverConfig) {
    this.rootDir = path.resolve(config.rootDir)
  }

  private keyToPath(key: string): string {
    return path.join(this.rootDir, key)
  }

  private async ensureDir(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
  }

  async uploadBuffer(key: string, data: Buffer, opts?: UploadOptions): Promise<StorageObject> {
    assertZavodCampPrefix(key, "uploadBuffer")
    const filePath = this.keyToPath(key)
    await this.ensureDir(filePath)
    await fs.writeFile(filePath, data)
    return {
      key,
      sizeBytes: BigInt(data.length),
      contentType: opts?.contentType,
      sha256: createHash("sha256").update(data).digest("hex"),
      createdAt: new Date(),
    }
  }

  async uploadFile(
    key: string,
    localPath: string,
    opts?: UploadOptions,
  ): Promise<StorageObject> {
    assertZavodCampPrefix(key, "uploadFile")
    const destPath = this.keyToPath(key)
    await this.ensureDir(destPath)

    const hash = createHash("sha256")
    const stat = await fs.stat(localPath)
    const readStream = createReadStream(localPath)
    readStream.on("data", (chunk) => hash.update(chunk))
    const writeStream = createWriteStream(destPath)
    await pipeline(readStream, writeStream)

    return {
      key,
      sizeBytes: BigInt(stat.size),
      contentType: opts?.contentType,
      sha256: hash.digest("hex"),
      createdAt: new Date(),
    }
  }

  async downloadToFile(key: string, localPath: string): Promise<void> {
    assertSafeKey(key, "downloadToFile")
    const sourcePath = this.keyToPath(key)
    if (!existsSync(sourcePath)) {
      throw new StorageError(`File not found: ${key}`, "NOT_FOUND", false)
    }
    await fs.mkdir(path.dirname(localPath), { recursive: true })
    await fs.copyFile(sourcePath, localPath)
  }

  async downloadToBuffer(key: string): Promise<Buffer> {
    assertSafeKey(key, "downloadToBuffer")
    const filePath = this.keyToPath(key)
    if (!existsSync(filePath)) {
      throw new StorageError(`File not found: ${key}`, "NOT_FOUND", false)
    }
    return fs.readFile(filePath)
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key, "exists")
    return existsSync(this.keyToPath(key))
  }

  async stat(key: string): Promise<StorageObject | null> {
    assertSafeKey(key, "stat")
    const filePath = this.keyToPath(key)
    if (!existsSync(filePath)) return null
    const s = await fs.stat(filePath)
    return {
      key,
      sizeBytes: BigInt(s.size),
      createdAt: s.birthtime,
    }
  }

  async getSignedDownloadUrl(key: string, _opts?: SignedUrlOptions): Promise<string> {
    assertSafeKey(key, "getSignedDownloadUrl")
    return `/api/files/${encodeURIComponent(key)}`
  }

  async delete(key: string): Promise<void> {
    assertZavodCampPrefix(key, "delete")
    const filePath = this.keyToPath(key)
    try {
      await fs.unlink(filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return
      throw err
    }
  }

  async deletePrefix(prefix: string): Promise<{ deletedCount: number }> {
    assertZavodCampPrefix(prefix, "deletePrefix")
    const dirPath = this.keyToPath(prefix)
    if (!existsSync(dirPath)) return { deletedCount: 0 }

    let deletedCount = 0
    const recurse = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await recurse(full)
          await fs.rmdir(full).catch(() => {})
        } else {
          await fs.unlink(full)
          deletedCount++
        }
      }
    }

    await recurse(dirPath)
    await fs.rmdir(dirPath).catch(() => {})
    return { deletedCount }
  }

  async list(prefix: string, opts?: { maxResults?: number }): Promise<StorageObject[]> {
    assertSafeKey(prefix, "list")
    const dirPath = this.keyToPath(prefix)
    if (!existsSync(dirPath)) return []

    const results: StorageObject[] = []
    const max = opts?.maxResults ?? Number.POSITIVE_INFINITY

    const recurse = async (dir: string, relative: string): Promise<void> => {
      if (results.length >= max) return
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (results.length >= max) return
        const full = path.join(dir, entry.name)
        const rel = path.posix.join(relative, entry.name)
        if (entry.isDirectory()) {
          await recurse(full, rel)
        } else {
          const s = await fs.stat(full)
          results.push({
            key: path.posix.join(prefix, rel),
            sizeBytes: BigInt(s.size),
            createdAt: s.birthtime,
          })
        }
      }
    }

    await recurse(dirPath, "")
    return results
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    assertSafeKey(sourceKey, "copy (source)")
    assertZavodCampPrefix(destKey, "copy (dest)")
    const src = this.keyToPath(sourceKey)
    const dst = this.keyToPath(destKey)
    if (!existsSync(src)) {
      throw new StorageError(`File not found: ${sourceKey}`, "NOT_FOUND", false)
    }
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.copyFile(src, dst)
  }
}
