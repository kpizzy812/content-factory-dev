/**
 * Unit-тесты video-fetcher.
 *
 * MockDriver сидируем буфером, проверяем roundtrip → temp file → cleanup
 * удаляет директорию.
 */
import { promises as fsp } from "node:fs"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../server/utils/storage", async () => {
  const { MockDriver } = await import("../../server/utils/storage/mock-driver")
  const mock = new MockDriver()
  return {
    getStorageDriver: () => mock,
    __mock: mock,
  }
})

import * as storageMod from "../../server/utils/storage"
import {
  downloadVideoForPosting,
  downloadVideoForPostingLegacy,
} from "../../server/automation/video-fetcher"

function mockDriver() {
  return (storageMod as unknown as { __mock: import("../../server/utils/storage/mock-driver").MockDriver }).__mock
}

describe("downloadVideoForPosting", () => {
  beforeEach(() => {
    mockDriver().clear()
  })

  afterEach(() => {
    mockDriver().clear()
  })

  it("скачивает видео в os.tmpdir и возвращает localPath с правильным размером", async () => {
    const data = Buffer.alloc(1024, 0xab) // 1KB
    const key = "zavodcamp/videos/123/test.mp4"
    await mockDriver().uploadBuffer(key, data, { contentType: "video/mp4" })

    const fetched = await downloadVideoForPosting({ storageKey: key, videoId: 123 })

    try {
      expect(fetched.localPath).toMatch(/zavodcamp-posting-/)
      expect(fetched.localPath).toMatch(/\.mp4$/)
      expect(fetched.sizeBytes).toBe(1024)
      const onDisk = await fsp.readFile(fetched.localPath)
      expect(onDisk.equals(data)).toBe(true)
    } finally {
      await fetched.cleanup()
    }
  })

  it("cleanup удаляет директорию", async () => {
    const data = Buffer.from("hello")
    const key = "zavodcamp/videos/1/test.mp4"
    await mockDriver().uploadBuffer(key, data)

    const fetched = await downloadVideoForPosting({ storageKey: key, videoId: 1 })
    await fetched.cleanup()

    await expect(fsp.access(fetched.localPath)).rejects.toThrow()
  })

  it("cleanup идемпотентен (повторный вызов не падает)", async () => {
    const data = Buffer.from("x")
    const key = "zavodcamp/videos/2/v.mp4"
    await mockDriver().uploadBuffer(key, data)
    const fetched = await downloadVideoForPosting({ storageKey: key, videoId: 2 })

    await fetched.cleanup()
    await expect(fetched.cleanup()).resolves.toBeUndefined()
  })

  it("throws при превышении maxSizeMb", async () => {
    // 1.5MB
    const data = Buffer.alloc(1_500_000, 0)
    const key = "zavodcamp/videos/3/big.mp4"
    await mockDriver().uploadBuffer(key, data)

    await expect(
      downloadVideoForPosting({ storageKey: key, videoId: 3, maxSizeMb: 1 }),
    ).rejects.toThrow(/превышает лимит/)
  })

  it("throws с понятным сообщением при отсутствии storageKey", async () => {
    await expect(
      downloadVideoForPosting({ storageKey: "zavodcamp/videos/missing.mp4", videoId: 999 }),
    ).rejects.toThrow(/Не удалось скачать/)
  })
})

describe("downloadVideoForPostingLegacy", () => {
  it("копирует из filePath", async () => {
    const tmpSrc = `/tmp/legacy-src-${Date.now()}.mp4`
    await fsp.writeFile(tmpSrc, Buffer.from("legacy data"))

    try {
      const fetched = await downloadVideoForPostingLegacy({
        filePath: tmpSrc,
        videoId: 10,
      })
      try {
        expect(fetched.sizeBytes).toBe(11)
        const onDisk = await fsp.readFile(fetched.localPath)
        expect(onDisk.toString()).toBe("legacy data")
      } finally {
        await fetched.cleanup()
      }
    } finally {
      await fsp.unlink(tmpSrc).catch(() => {})
    }
  })

  it("throws если нет ни filePath ни fileUrl", async () => {
    await expect(
      downloadVideoForPostingLegacy({ videoId: 99 }),
    ).rejects.toThrow(/не имеет ни storageKey/)
  })
})
