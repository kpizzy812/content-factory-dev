/**
 * Unit-тесты Instagram Reel-постера (Этап 3, P8) против stateful mock-сервера DuoPlus.
 *
 * Mock воспроизводит последовательность IG-экранов flow калибровки (feed → [свайп] →
 * camera(REEL) → gallery → editor → promo → caption → audio(Share) → MainTabActivity),
 * продвигая её на свайпах/тапах в advance-зоны. dumpsys activity отдаёт MainTabActivity
 * после Share (success-detection). Проверяем: полный happy-path постинга через постер
 * напрямую, через AdbAutomationEngine.postVideo (lifecycle + success), хелперы
 * swipe/currentActivity/dismissPromos, и fail когда видео не нашлось в галерее.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createDuoplusMockServer,
  DUOPLUS_STATUS,
  type DuoplusMockHandle,
} from "../../server/__mocks__/duoplus-server"
import { resetDuoplusClient } from "../../server/utils/posting-provider/duoplus-client"
import { getStorageDriver, resetStorageDriver } from "../../server/utils/storage"
import {
  currentActivity,
  dismissPromos,
  swipe,
} from "../../server/automation/automation-engine/adb-shell"
import { postInstagramReel } from "../../server/automation/automation-engine/posters/instagram-poster"
import {
  AdbAutomationEngine,
  type AdbPostInput,
} from "../../server/automation/automation-engine/adb-automation-engine"
import { PostingPhaseError } from "../../server/automation/posters/types"

const API_KEY = "test-key-from-env"
const IMAGE_ID = "M2Hxh"
const CAPTION = "DuoPlus Reel test"

function setMockEnv(baseUrl: string): void {
  process.env.DUOPLUS_MOCK_MODE = "true"
  process.env.DUOPLUS_MOCK_URL = baseUrl
  process.env.DUOPLUS_API_KEY = API_KEY
  process.env.STORAGE_DRIVER = "mock"
  resetDuoplusClient()
  resetStorageDriver()
}

function clearMockEnv(): void {
  resetDuoplusClient()
  delete process.env.DUOPLUS_MOCK_MODE
  delete process.env.DUOPLUS_MOCK_URL
  delete process.env.DUOPLUS_API_KEY
  delete process.env.STORAGE_DRIVER
  resetStorageDriver()
}

describe("postInstagramReel (mock, прямой вызов)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
    // Имитируем уже залитое видео (P3 media-push выставляет _igVideoFile через curl).
    mock.devices.get(IMAGE_ID)!._igVideoFile = "job-1.mp4"
    mock.devices.get(IMAGE_ID)!._igScreen = "ig_feed"
  })

  afterEach(async () => {
    clearMockEnv()
    await mock.close()
  })

  it("проходит весь flow до Share и подтверждает публикацию по activity", async () => {
    const result = await postInstagramReel({
      imageId: IMAGE_ID,
      deviceVideoPath: "/sdcard/DCIM/job-1.mp4",
      caption: CAPTION,
    })
    expect(result.published).toBe(true)
    // После Share устройство вернулось на MainTabActivity (публикация состоялась).
    expect(mock.devices.get(IMAGE_ID)!._igActivity).toContain("MainTabActivity")
    expect(mock.devices.get(IMAGE_ID)!._igCaption).toBe(CAPTION)
  })

  it("видео не нашлось в галерее → PostingPhaseError(file_upload)", async () => {
    // Видео не залито → галерея без video-thumbnail (постер не найдёт ни basename,
    // ни generic «Video thumbnail»).
    mock.devices.get(IMAGE_ID)!._igVideoFile = ""
    const result = postInstagramReel({
      imageId: IMAGE_ID,
      deviceVideoPath: "/sdcard/DCIM/does-not-exist.mp4",
      caption: CAPTION,
    })
    await expect(result).rejects.toBeInstanceOf(PostingPhaseError)
    await expect(result).rejects.toMatchObject({ phase: "file_upload" })
  })
})

describe("adb-shell IG-хелперы (mock)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
  })

  afterEach(async () => {
    clearMockEnv()
    await mock.close()
  })

  it("swipe вправо с feed открывает camera-create", async () => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev._igScreen = "ig_feed"
    await swipe(IMAGE_ID, 150, 960, 950, 960, 250)
    expect(dev._igScreen).toBe("ig_camera")
  })

  it("currentActivity парсит ResumedActivity-компонент из dumpsys", async () => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev._igActivity = "com.instagram.android/.activity.MainTabActivity"
    const act = await currentActivity(IMAGE_ID)
    expect(act).toContain("MainTabActivity")
  })

  it("dismissPromos закрывает промо-оверлей (reuse OK) и возвращает счётчик", async () => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev._igScreen = "ig_promo"
    const dismissed = await dismissPromos(IMAGE_ID, { maxRounds: 3 })
    expect(dismissed).toBe(1)
    // После закрытия промо flow ушёл на caption.
    expect(dev._igScreen).toBe("ig_caption")
  })

  it("dismissPromos на экране без промо возвращает 0", async () => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev._igScreen = "ig_camera"
    const dismissed = await dismissPromos(IMAGE_ID, { maxRounds: 3 })
    expect(dismissed).toBe(0)
  })
})

describe("AdbAutomationEngine.postVideo → instagram (full lifecycle, mock)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
  })

  afterEach(async () => {
    clearMockEnv()
    await mock.close()
  })

  it("публикует Reel и выключает устройство в finally", async () => {
    // Движок скачивает видео из GCS в tmp перед заливкой через Cloud Drive.
    await getStorageDriver().uploadBuffer(
      "zavodcamp/videos/job-1.mp4",
      Buffer.alloc(1024, 1),
      { contentType: "video/mp4" },
    )
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
      platform: "instagram",
    }
    const result = await engine.postVideo(input)
    expect(result.success).toBe(true)
    expect(mock.devices.get(IMAGE_ID)!._igCaption).toBe(CAPTION)
    // powerOff в finally → устройство выключено.
    expect(mock.devices.get(IMAGE_ID)!.status).toBe(DUOPLUS_STATUS.OFF)
  })
})
