/**
 * Unit-тесты YouTube Short-постера (Этап 3, P4) против stateful mock-сервера DuoPlus.
 *
 * Mock воспроизводит последовательность экранов flow калибровки (home → permissions →
 * Short-камера → permissions → галерея → trim → editing → details → канал), продвигая
 * её на тапах в advance-зоны. Проверяем: полный happy-path постинга через постер
 * напрямую, через AdbAutomationEngine.postVideo (lifecycle + success), handlePermissions,
 * и success-detection (fail, если caption не нашёлся на канале).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createDuoplusMockServer,
  DUOPLUS_STATUS,
  type DuoplusMockHandle,
} from "../../server/__mocks__/duoplus-server"
import { resetDuoplusClient } from "../../server/utils/posting-provider/duoplus-client"
import { getStorageDriver, resetStorageDriver } from "../../server/utils/storage"
import { handlePermissions } from "../../server/automation/automation-engine/adb-shell"
import { postYouTubeShort } from "../../server/automation/automation-engine/posters/youtube-poster"
import {
  AdbAutomationEngine,
  type AdbPostInput,
} from "../../server/automation/automation-engine/adb-automation-engine"
import { PostingPhaseError } from "../../server/automation/posters/types"

const API_KEY = "test-key-from-env"
const IMAGE_ID = "M2Hxh"
const CAPTION = "DuoPlus autopost test"

function setMockEnv(baseUrl: string): void {
  process.env.DUOPLUS_MOCK_MODE = "true"
  process.env.DUOPLUS_MOCK_URL = baseUrl
  process.env.DUOPLUS_API_KEY = API_KEY
  process.env.STORAGE_DRIVER = "mock"
  // Быстрые таймауты waitUploadComplete (mock не отдаёт «Uploading» → fallback).
  process.env.YT_UPLOAD_APPEAR_MS = "1"
  process.env.YT_UPLOAD_FALLBACK_MS = "1"
  process.env.YT_UPLOAD_WAIT_MS = "1"
  process.env.YT_UPLOAD_POLL_MS = "1"
  resetDuoplusClient()
  resetStorageDriver()
}

function clearMockEnv(): void {
  resetDuoplusClient()
  delete process.env.DUOPLUS_MOCK_MODE
  delete process.env.DUOPLUS_MOCK_URL
  delete process.env.DUOPLUS_API_KEY
  delete process.env.STORAGE_DRIVER
  delete process.env.YT_UPLOAD_APPEAR_MS
  delete process.env.YT_UPLOAD_FALLBACK_MS
  delete process.env.YT_UPLOAD_WAIT_MS
  delete process.env.YT_UPLOAD_POLL_MS
  resetStorageDriver()
}

describe("postYouTubeShort (mock, прямой вызов)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
    // Имитируем уже залитое видео (P3 media-push выставляет _ytVideoFile через curl).
    mock.devices.get(IMAGE_ID)!._ytVideoFile = "job-1.mp4"
    mock.devices.get(IMAGE_ID)!._ytScreen = "home"
  })

  afterEach(async () => {
    clearMockEnv()
    await mock.close()
  })

  it("проходит весь flow до канала и подтверждает публикацию", async () => {
    const result = await postYouTubeShort({
      imageId: IMAGE_ID,
      deviceVideoPath: "/sdcard/DCIM/job-1.mp4",
      caption: CAPTION,
    })
    expect(result.published).toBe(true)
    // Устройство дошло до экрана канала (публикация состоялась).
    expect(mock.devices.get(IMAGE_ID)!._ytScreen).toBe("channel")
    expect(mock.devices.get(IMAGE_ID)!._ytCaption).toBe(CAPTION)
  })

  it("видео не нашлось в галерее → PostingPhaseError(file_upload)", async () => {
    // Перед запуском постера ставим устройство на «застрявший» экран деталей,
    // на котором тап Upload Short не сработает (advance-зона отсутствует у этого
    // подменённого caption) — публикация не доказывается. Моделируем расхождение:
    // device-caption отличается от того, что ищет verify. Самый прямой способ —
    // подсунуть постеру caption, которого НЕ будет в channel-desc: мок пишет в
    // _ytCaption то, что реально набрано через input text. Поэтому ломаем шаг
    // публикации: уберём deviceVideoPath-файл из gallery (видео не выбрать) — flow
    // не дойдёт до канала и упадёт на file_upload.
    const result = postYouTubeShort({
      imageId: IMAGE_ID,
      deviceVideoPath: "/sdcard/DCIM/does-not-exist.mp4", // в галерее нет такого thumbnail
      caption: CAPTION,
    })
    await expect(result).rejects.toBeInstanceOf(PostingPhaseError)
    await expect(result).rejects.toMatchObject({ phase: "file_upload" })
  })

  it("пустой caption → НЕ фейковый success, а upload_failed (защита от ложного «Опубликовано»)", async () => {
    // Регрессия фейкового «Опубликовано»: раньше при пустом caption verifyPublished
    // матчил ЛЮБОЙ «No views» на экране (needle="" → hasCaption=true всегда) и
    // возвращал success, хотя видео могло не залиться. Теперь пустой caption плитку
    // не доказывает, channel_fetch без handle/caption тоже → upload_failed (retry).
    const result = postYouTubeShort({
      imageId: IMAGE_ID,
      deviceVideoPath: "/sdcard/DCIM/job-1.mp4",
      caption: "",
    })
    await expect(result).rejects.toBeInstanceOf(PostingPhaseError)
    await expect(result).rejects.toMatchObject({
      phase: "extract_url",
      category: "upload_failed",
    })
  })
})

describe("handlePermissions (mock)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
  })

  afterEach(async () => {
    clearMockEnv()
    await mock.close()
  })

  it("обрабатывает 3 permission-диалога при первом Create (камера/микрофон/photos)", async () => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev._ytScreen = "perm_camera"
    // 3 диалога: perm_camera → perm_mic → short_camera (на short_camera нет allow-кнопки).
    // handlePermissions тапает allow, пока есть кнопка. Но переход perm_mic→short_camera
    // требует тапа в allow-зону; perm-экраны имеют permission_allow_all_button.
    const handled = await handlePermissions(IMAGE_ID, { maxRounds: 4 })
    expect(handled).toBe(2) // camera + mic; на short_camera allow-кнопки нет → стоп
    expect(dev._ytScreen).toBe("short_camera")
  })

  it("на экране без permission-диалога возвращает 0", async () => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev._ytScreen = "home"
    const handled = await handlePermissions(IMAGE_ID, { maxRounds: 4 })
    expect(handled).toBe(0)
  })
})

describe("AdbAutomationEngine.postVideo → youtube (full lifecycle, mock)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
    // Движок скачивает видео из GCS в tmp перед заливкой через Cloud Drive —
    // кладём файлы в mock storage под теми же storageKey.
    const storage = getStorageDriver()
    await storage.uploadBuffer("zavodcamp/videos/job-1.mp4", Buffer.alloc(1024, 1), { contentType: "video/mp4" })
    await storage.uploadBuffer("zavodcamp/videos/job-7.mp4", Buffer.alloc(1024, 1), { contentType: "video/mp4" })
  })

  afterEach(async () => {
    clearMockEnv()
    await mock.close()
  })

  it("публикует Short и выключает устройство в finally", async () => {
    const engine = new AdbAutomationEngine({
      powerOnPollIntervalMs: 1,
      powerOnTimeoutMs: 10_000,
      mediaPollIntervalMs: 1,
    })
    const input: AdbPostInput = {
      imageId: IMAGE_ID,
      storageKey: "zavodcamp/videos/job-1.mp4",
      videoId: 1,
      videoLocalPath: "/tmp/x.mp4",
      caption: CAPTION,
      jobId: "job-1",
      platform: "youtube",
    }
    const result = await engine.postVideo(input)
    expect(result.success).toBe(true)
    // powerOff в finally → устройство выключено.
    expect(mock.devices.get(IMAGE_ID)!.status).toBe(DUOPLUS_STATUS.OFF)
  })

  it("использует title как caption Short, если он задан (fallback на caption)", async () => {
    const engine = new AdbAutomationEngine({
      powerOnPollIntervalMs: 1,
      powerOnTimeoutMs: 10_000,
      mediaPollIntervalMs: 1,
    })
    const input: AdbPostInput = {
      imageId: IMAGE_ID,
      storageKey: "zavodcamp/videos/job-7.mp4",
      videoId: 7,
      videoLocalPath: "/tmp/x.mp4",
      caption: "fallback caption",
      title: "My Short Title",
      jobId: "job-7",
      platform: "youtube",
    }
    await engine.postVideo(input)
    expect(mock.devices.get(IMAGE_ID)!._ytCaption).toBe("My Short Title")
  })
})
