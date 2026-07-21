#!/usr/bin/env bun
/**
 * Smoke-test всех методов StorageDriver на текущем drivers'е. Запускается
 * на любой имплементации — mock, local, gcs — и валит весь набор путей.
 *
 * Запуск:
 *   STORAGE_DRIVER=mock bun run scripts/test-storage-driver.ts
 *   STORAGE_DRIVER=local bun run scripts/test-storage-driver.ts
 *   STORAGE_DRIVER=gcs bun run scripts/test-storage-driver.ts        # требует креды
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { rm, readFile } from "node:fs/promises"
import {
  describeStorageDriver,
  getStorageDriver,
  StorageError,
  StorageKeys,
} from "../server/utils/storage"

const TEST_VIDEO_ID = "smoke-" + Date.now().toString(36)

async function runTests() {
  const storage = getStorageDriver()
  console.log(`Driver: ${storage.providerName}`)
  console.log(`Desc:`, describeStorageDriver())
  console.log()

  let passed = 0
  let failed = 0
  const usedKeys = new Set<string>()
  const track = (key: string) => {
    usedKeys.add(key)
    return key
  }

  const test = async (name: string, fn: () => Promise<void>) => {
    const startedAt = Date.now()
    try {
      await fn()
      const ms = Date.now() - startedAt
      console.log(`  PASS  [${String(ms).padStart(5)}ms]  ${name}`)
      passed++
    } catch (err) {
      const ms = Date.now() - startedAt
      console.error(`  FAIL  [${String(ms).padStart(5)}ms]  ${name}:`, err instanceof Error ? err.message : err)
      failed++
    }
  }

  await test("uploadBuffer + downloadToBuffer roundtrip", async () => {
    const key = track(StorageKeys.videoSceneImage(TEST_VIDEO_ID, 1, "png"))
    const data = Buffer.from("image-data-" + Math.random())
    const obj = await storage.uploadBuffer(key, data, { contentType: "image/png" })
    if (obj.sizeBytes !== BigInt(data.length)) {
      throw new Error(`size mismatch: ${obj.sizeBytes} vs ${data.length}`)
    }
    const downloaded = await storage.downloadToBuffer(key)
    if (!downloaded.equals(data)) throw new Error("content mismatch")
    await storage.delete(key)
  })

  await test("uploadFile + downloadToFile roundtrip", async () => {
    mkdirSync("tmp", { recursive: true })
    const localPath = `tmp/smoke-${TEST_VIDEO_ID}.txt`
    writeFileSync(localPath, "hello world")
    const key = track(StorageKeys.tempFile(TEST_VIDEO_ID, "hello.txt"))
    await storage.uploadFile(key, localPath, { contentType: "text/plain" })

    const downloadedPath = `tmp/smoke-${TEST_VIDEO_ID}-downloaded.txt`
    await storage.downloadToFile(key, downloadedPath)
    const original = await readFile(localPath, "utf-8")
    const downloaded = await readFile(downloadedPath, "utf-8")
    if (original !== downloaded) throw new Error("file content mismatch")

    await storage.delete(key)
    await rm(localPath, { force: true })
    await rm(downloadedPath, { force: true })
  })

  await test("exists + stat", async () => {
    const key = track(StorageKeys.videoSceneImage(TEST_VIDEO_ID, 2, "png"))
    if (await storage.exists(key)) throw new Error("should not exist before upload")
    await storage.uploadBuffer(key, Buffer.from("x"), { contentType: "image/png" })
    if (!(await storage.exists(key))) throw new Error("should exist after upload")
    const stat = await storage.stat(key)
    if (!stat || stat.key !== key) throw new Error("stat key mismatch")
    await storage.delete(key)
    if (await storage.exists(key)) throw new Error("should not exist after delete")
  })

  await test("getSignedDownloadUrl", async () => {
    const key = track(StorageKeys.videoFinal(TEST_VIDEO_ID))
    await storage.uploadBuffer(key, Buffer.from("video-data"), { contentType: "video/mp4" })
    const url = await storage.getSignedDownloadUrl(key, { expiresInSec: 60 })
    if (!url || url.length < 10) throw new Error(`invalid signed URL: ${url}`)
    if (storage.providerName === "gcs" && !url.includes("storage.googleapis.com")) {
      throw new Error(`expected GCS URL host, got: ${url}`)
    }
    await storage.delete(key)
  })

  await test("list + deletePrefix", async () => {
    const prefix = StorageKeys.videoPrefix(TEST_VIDEO_ID)
    await storage.uploadBuffer(track(StorageKeys.videoFinal(TEST_VIDEO_ID)), Buffer.from("1"))
    await storage.uploadBuffer(track(StorageKeys.videoSceneClip(TEST_VIDEO_ID, 1)), Buffer.from("2"))
    await storage.uploadBuffer(track(StorageKeys.videoVoiceoverMix(TEST_VIDEO_ID)), Buffer.from("3"))

    const list = await storage.list(prefix)
    if (list.length < 3) throw new Error(`expected >= 3, got ${list.length}`)

    const { deletedCount } = await storage.deletePrefix(prefix)
    if (deletedCount < 3) throw new Error(`expected >= 3 deleted, got ${deletedCount}`)

    const afterList = await storage.list(prefix)
    if (afterList.length !== 0) throw new Error(`expected empty list, got ${afterList.length}`)
  })

  await test("PrefixGuard blocks marketingcamp/ writes", async () => {
    try {
      await storage.uploadBuffer("marketingcamp/evil.mp4", Buffer.from("x"))
      throw new Error("should have thrown PrefixGuard")
    } catch (err) {
      if (!(err instanceof StorageError) || err.code !== "PREFIX_GUARD") {
        throw new Error(`wrong error code: ${err instanceof StorageError ? err.code : err}`)
      }
    }
    try {
      await storage.delete("marketingcamp/some.png")
      throw new Error("delete should have thrown")
    } catch (err) {
      if (!(err instanceof StorageError) || err.code !== "PREFIX_GUARD") throw err
    }
  })

  await test("path traversal blocked", async () => {
    try {
      await storage.uploadBuffer("zavodcamp/../etc/passwd", Buffer.from("x"))
      throw new Error("should have blocked traversal")
    } catch (err) {
      if (!(err instanceof StorageError) || err.code !== "INVALID_KEY") throw err
    }
  })

  await test("copy + dest PrefixGuard", async () => {
    const src = track(StorageKeys.tempFile(TEST_VIDEO_ID, "src.txt"))
    const dst = track(StorageKeys.tempFile(TEST_VIDEO_ID, "dst.txt"))
    await storage.uploadBuffer(src, Buffer.from("hello"))
    await storage.copy(src, dst)
    const dstData = await storage.downloadToBuffer(dst)
    if (dstData.toString() !== "hello") throw new Error("copy content mismatch")
    try {
      await storage.copy(src, "marketingcamp/leak.txt")
      throw new Error("copy dest guard missing")
    } catch (err) {
      if (!(err instanceof StorageError) || err.code !== "PREFIX_GUARD") throw err
    }
    await storage.delete(src)
    await storage.delete(dst)
  })

  await test("delete idempotent", async () => {
    const key = track(StorageKeys.tempFile(TEST_VIDEO_ID, "idem.txt"))
    await storage.uploadBuffer(key, Buffer.from("x"))
    await storage.delete(key)
    await storage.delete(key) // second delete must not throw
  })

  // === Final sweep + accountability ===
  console.log("\n--- All storage keys used during smoke (zavodcamp/ prefix enforced) ---")
  const sorted = Array.from(usedKeys).sort()
  for (const k of sorted) console.log(`  ${k}`)
  console.log(`  total: ${sorted.length}`)

  // Финальная сверка: ничего не должно остаться под smoke-* префиксом.
  // Каждый тест уже cleanup'ит свои ключи; этот sweep ловит регрессии cleanup'а.
  console.log("\n--- Final sweep: list under smoke prefixes ---")
  const sweepPrefixes = [
    `zavodcamp/videos/${TEST_VIDEO_ID}/`,
    `zavodcamp/temp/${TEST_VIDEO_ID}/`,
  ]
  let residual = 0
  for (const prefix of sweepPrefixes) {
    const list = await storage.list(prefix)
    if (list.length > 0) {
      console.warn(`  WARN ${list.length} residual under ${prefix}:`)
      for (const o of list) console.warn(`    ${o.key}`)
      const { deletedCount } = await storage.deletePrefix(prefix)
      console.warn(`  swept: ${deletedCount}`)
      residual += list.length
    } else {
      console.log(`  CLEAN  ${prefix}`)
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`)
  if (residual > 0) console.warn(`Residual cleanup performed for ${residual} object(s)`)
  if (failed > 0) process.exit(1)
}

runTests().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
