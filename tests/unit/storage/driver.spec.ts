/**
 * Unit-тесты storage driver'а на MockDriver. Цель — зафиксировать контракт
 * PrefixGuard / path-traversal / роundtrip'а независимо от реальной FS или
 * сетевой инфраструктуры. Те же кейсы прогоняются на GCS через
 * scripts/test-storage-driver.ts когда есть прод-credentials.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { StorageKeys } from "../../../server/utils/storage/keys"
import { MockDriver } from "../../../server/utils/storage/mock-driver"
import { StorageError } from "../../../server/utils/storage/types"

describe("MockDriver", () => {
  let driver: MockDriver

  beforeEach(() => {
    driver = new MockDriver()
  })

  afterEach(() => {
    driver.clear()
  })

  it("uploads and downloads buffer roundtrip", async () => {
    const key = StorageKeys.videoFinal(1)
    const data = Buffer.from("test data")
    await driver.uploadBuffer(key, data, { contentType: "video/mp4" })
    const downloaded = await driver.downloadToBuffer(key)
    expect(downloaded.equals(data)).toBe(true)
  })

  it("throws PREFIX_GUARD on upload outside zavodcamp/", async () => {
    await expect(
      driver.uploadBuffer("marketingcamp/bad.mp4", Buffer.from("data")),
    ).rejects.toMatchObject({ code: "PREFIX_GUARD" })
  })

  it("throws PREFIX_GUARD on delete outside zavodcamp/", async () => {
    await expect(driver.delete("marketingcamp/bad.mp4")).rejects.toMatchObject({
      code: "PREFIX_GUARD",
    })
  })

  it("throws PREFIX_GUARD on deletePrefix outside zavodcamp/", async () => {
    await expect(driver.deletePrefix("marketingcamp/")).rejects.toMatchObject({
      code: "PREFIX_GUARD",
    })
  })

  it("throws INVALID_KEY on path traversal", async () => {
    await expect(
      driver.uploadBuffer("zavodcamp/../etc/passwd", Buffer.from("data")),
    ).rejects.toMatchObject({ code: "INVALID_KEY" })
  })

  it("throws NOT_FOUND on download of missing key", async () => {
    await expect(driver.downloadToBuffer("zavodcamp/nope.mp4")).rejects.toThrow(
      StorageError,
    )
  })

  it("exists returns false for missing key", async () => {
    expect(await driver.exists("zavodcamp/nope.mp4")).toBe(false)
  })

  it("deletePrefix removes all matching keys", async () => {
    const prefix = StorageKeys.videoPrefix(2)
    await driver.uploadBuffer(StorageKeys.videoFinal(2), Buffer.from("1"))
    await driver.uploadBuffer(StorageKeys.videoSceneClip(2, 1), Buffer.from("2"))
    const { deletedCount } = await driver.deletePrefix(prefix)
    expect(deletedCount).toBe(2)
    expect(await driver.exists(StorageKeys.videoFinal(2))).toBe(false)
  })

  it("list returns objects with prefix", async () => {
    const prefix = StorageKeys.videoPrefix(3)
    await driver.uploadBuffer(StorageKeys.videoFinal(3), Buffer.from("1"))
    await driver.uploadBuffer(StorageKeys.videoSceneClip(3, 1), Buffer.from("2"))
    const list = await driver.list(prefix)
    expect(list.length).toBe(2)
  })

  it("delete is idempotent", async () => {
    const key = StorageKeys.tempFile("run-1", "x.txt")
    await driver.uploadBuffer(key, Buffer.from("x"))
    await driver.delete(key)
    await expect(driver.delete(key)).resolves.toBeUndefined()
  })

  it("signed URL includes expires param", async () => {
    const key = StorageKeys.videoFinal(4)
    await driver.uploadBuffer(key, Buffer.from("data"))
    const url = await driver.getSignedDownloadUrl(key, { expiresInSec: 1800 })
    expect(url).toContain("expires=")
  })

  it("copy enforces dest PrefixGuard", async () => {
    const src = StorageKeys.tempFile("run-1", "src.txt")
    await driver.uploadBuffer(src, Buffer.from("x"))
    await expect(driver.copy(src, "marketingcamp/leak.txt")).rejects.toMatchObject({
      code: "PREFIX_GUARD",
    })
  })
})
