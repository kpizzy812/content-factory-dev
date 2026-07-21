/**
 * Unit-тесты AdbAutomationEngine (Этап 3, P2) против in-process mock-сервера DuoPlus.
 *
 * Покрывает: powerOnDevice (poll status 2→10→1, adb появляется при ON),
 * device_offline → DEVICE_POWER_FAILED, terminal-статус 12 → DEVICE_CONFIG_ERROR,
 * powerOffDevice, dispatch → POSTER_NOT_IMPLEMENTED для каждой платформы,
 * postVideo lifecycle (powerOff вызван в finally даже при ошибке постера).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createDuoplusMockServer,
  DUOPLUS_STATUS,
  type DuoplusMockHandle,
} from "../../server/__mocks__/duoplus-server"
import { resetDuoplusClient } from "../../server/utils/posting-provider/duoplus-client"
import { DUOPLUS_DEVICE_STATUS } from "../../server/utils/posting-provider/duoplus-types"
import { getStorageDriver, resetStorageDriver } from "../../server/utils/storage"
import {
  AdbAutomationEngine,
  AdbEngineError,
  DEVICE_CONFIG_ERROR,
  DEVICE_COOLDOWN,
  DEVICE_POWER_FAILED,
  POSTER_NOT_IMPLEMENTED,
  type AdbPostInput,
} from "../../server/automation/automation-engine/adb-automation-engine"
import type { Platform } from "../../app/generated/prisma/enums"

const API_KEY = "test-key-from-env"
const IMAGE_ID = "M2Hxh"

function baseInput(platform: Platform, imageId = IMAGE_ID): AdbPostInput {
  return {
    imageId,
    storageKey: "zavodcamp/videos/job-1.mp4",
    videoId: 1,
    videoLocalPath: "/tmp/x.mp4",
    caption: "test",
    jobId: "job-1",
    platform,
  }
}

/** Кладёт видео в mock storage (движок скачивает из GCS в tmp перед Cloud Drive). */
async function seedVideo(): Promise<void> {
  await getStorageDriver().uploadBuffer(
    "zavodcamp/videos/job-1.mp4",
    Buffer.alloc(1024, 1),
    { contentType: "video/mp4" },
  )
}

function setMockEnv(baseUrl: string): void {
  process.env.DUOPLUS_MOCK_MODE = "true"
  process.env.DUOPLUS_MOCK_URL = baseUrl
  process.env.DUOPLUS_API_KEY = API_KEY
  // mock storage (in-memory): движок скачивает видео из GCS в tmp перед заливкой
  // через Cloud Drive — тесты кладут файлы в store через seedVideo/uploadBuffer.
  process.env.STORAGE_DRIVER = "mock"
  resetDuoplusClient()
  resetStorageDriver()
}

describe("AdbAutomationEngine.powerOnDevice (mock)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
  })

  afterEach(async () => {
    resetDuoplusClient()
    delete process.env.DUOPLUS_MOCK_MODE
    delete process.env.DUOPLUS_MOCK_URL
    delete process.env.DUOPLUS_API_KEY

    delete process.env.STORAGE_DRIVER

    resetStorageDriver()
    await mock.close()
  })

  it("поллит до status=1 и возвращает устройство с adb-адресом", async () => {
    const engine = new AdbAutomationEngine({ powerOnPollIntervalMs: 1, powerOnTimeoutMs: 10_000 })
    const dev = await engine.powerOnDevice(IMAGE_ID)
    expect(dev.status).toBe(DUOPLUS_DEVICE_STATUS.ON)
    expect(dev.adb).toMatch(/^\d+\.\d+\.\d+\.\d+:\d+$/)
  })

  it("powerOffDevice возвращает устройство в OFF (best-effort, не бросает)", async () => {
    const engine = new AdbAutomationEngine({ powerOnPollIntervalMs: 1, powerOnTimeoutMs: 10_000 })
    await engine.powerOnDevice(IMAGE_ID)
    await expect(engine.powerOffDevice(IMAGE_ID)).resolves.toBeUndefined()
    const dev = (await (await import("../../server/utils/posting-provider/duoplus-client")).getDuoplusClient().listCloudPhones()).find((d) => d.id === IMAGE_ID)!
    expect(dev.status).toBe(DUOPLUS_DEVICE_STATUS.OFF)
  })
})

describe("AdbAutomationEngine.powerOnDevice: ошибки", () => {
  afterEach(() => {
    resetDuoplusClient()
    delete process.env.DUOPLUS_MOCK_MODE
    delete process.env.DUOPLUS_MOCK_URL
    delete process.env.DUOPLUS_API_KEY

    delete process.env.STORAGE_DRIVER

    resetStorageDriver()
  })

  it("device_offline → AdbEngineError DEVICE_POWER_FAILED", async () => {
    const mock = await createDuoplusMockServer({ defaultScenario: "device_offline" })
    setMockEnv(mock.baseUrl)
    const engine = new AdbAutomationEngine({ powerOnPollIntervalMs: 1, powerOnTimeoutMs: 5_000 })
    await expect(engine.powerOnDevice(IMAGE_ID)).rejects.toMatchObject({
      code: DEVICE_POWER_FAILED,
    })
    await mock.close()
  })

  it("terminal-статус устройства (config error) во время poll → DEVICE_CONFIG_ERROR terminal", async () => {
    // powerOnTicks большой → устройство задержится в POWERING_ON, успеем
    // подменить его статус на CONFIG_ERROR между поллами, чтобы poll поймал terminal.
    const mock = await createDuoplusMockServer({ powerOnTicks: 5 })
    setMockEnv(mock.baseUrl)
    const engine = new AdbAutomationEngine({ powerOnPollIntervalMs: 5, powerOnTimeoutMs: 5_000 })

    // Запускаем powerOn (mock переведёт OFF→POWERING_ON), параллельно ломаем устройство.
    const dev = mock.devices.get(IMAGE_ID)!
    const promise = engine.powerOnDevice(IMAGE_ID)
    // После старта первого list устройство в POWERING_ON — портим в CONFIG_ERROR.
    setTimeout(() => {
      dev.status = DUOPLUS_STATUS.CONFIG_ERROR
      dev._ticksToOn = undefined
    }, 8)

    await expect(promise).rejects.toMatchObject({ code: DEVICE_CONFIG_ERROR })
    await mock.close()
  })

  it("отсутствие imageId → DEVICE_POWER_FAILED при postVideo", async () => {
    const mock = await createDuoplusMockServer()
    setMockEnv(mock.baseUrl)
    const engine = new AdbAutomationEngine()
    const input = baseInput("youtube")
    delete input.imageId
    await expect(engine.postVideo(input)).rejects.toMatchObject({ code: DEVICE_POWER_FAILED })
    await mock.close()
  })
})

describe("AdbAutomationEngine.powerOnDevice: pre-check статуса (per-device кулдаун)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
  })

  afterEach(async () => {
    resetDuoplusClient()
    delete process.env.DUOPLUS_MOCK_MODE
    delete process.env.DUOPLUS_MOCK_URL
    delete process.env.DUOPLUS_API_KEY
    delete process.env.STORAGE_DRIVER
    resetStorageDriver()
    await mock.close()
  })

  function engine(): AdbAutomationEngine {
    return new AdbAutomationEngine({ powerOnPollIntervalMs: 1, powerOnTimeoutMs: 5_000 })
  }

  it("status=ON (1) → залипшее устройство гасится best-effort + DEVICE_COOLDOWN retryable", async () => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev.status = DUOPLUS_STATUS.ON
    dev._ticksToOn = undefined
    const err = await engine()
      .powerOnDevice(IMAGE_ID)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AdbEngineError)
    // Семафор BA=1 + 1:1:1 → ON = осиротевшее устройство (мёртвый процесс не погасил).
    // Гасим best-effort и уходим в cooldown — не вечный device_busy 4/5.
    expect(err).toMatchObject({ code: DEVICE_COOLDOWN, terminal: false })
    // powerOff действительно вызван — устройство сброшено в OFF, не залипло ON.
    expect(dev.status).toBe(DUOPLUS_STATUS.OFF)
  })

  it("status=POWERING_ON (10) → DEVICE_COOLDOWN retryable (устройство остывает)", async () => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev.status = DUOPLUS_STATUS.POWERING_ON
    dev._ticksToOn = undefined
    const err = await engine()
      .powerOnDevice(IMAGE_ID)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AdbEngineError)
    expect(err).toMatchObject({ code: DEVICE_COOLDOWN, terminal: false })
  })

  it("status=CONFIGURING (11) → DEVICE_COOLDOWN retryable", async () => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev.status = DUOPLUS_STATUS.CONFIGURING
    dev._ticksToOn = undefined
    const err = await engine()
      .powerOnDevice(IMAGE_ID)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AdbEngineError)
    expect(err).toMatchObject({ code: DEVICE_COOLDOWN, terminal: false })
  })

  it.each([
    ["EXPIRED", DUOPLUS_STATUS.EXPIRED],
    ["UNPAID", DUOPLUS_STATUS.UNPAID],
    ["CONFIG_ERROR", DUOPLUS_STATUS.CONFIG_ERROR],
  ])("terminal-статус %s → DEVICE_CONFIG_ERROR terminal (pre-check)", async (_label, status) => {
    const dev = mock.devices.get(IMAGE_ID)!
    dev.status = status
    dev._ticksToOn = undefined
    const err = await engine()
      .powerOnDevice(IMAGE_ID)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AdbEngineError)
    expect(err).toMatchObject({ code: DEVICE_CONFIG_ERROR, terminal: true })
  })

  it("status=OFF (2) → обычный powerOn + poll до ON (pre-check пропускает)", async () => {
    // Дефолтный seed устройства — OFF; pre-check должен пропустить в обычный powerOn.
    const dev = await engine().powerOnDevice(IMAGE_ID)
    expect(dev.status).toBe(DUOPLUS_DEVICE_STATUS.ON)
  })

  it("устройство отсутствует в списке → DEVICE_CONFIG_ERROR terminal", async () => {
    const err = await engine()
      .powerOnDevice("UNKNOWN_DEVICE")
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AdbEngineError)
    expect(err).toMatchObject({ code: DEVICE_CONFIG_ERROR, terminal: true })
  })
})

describe("AdbAutomationEngine.postVideo: dispatch (P2 заглушка)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
    await seedVideo()
  })

  afterEach(async () => {
    resetDuoplusClient()
    delete process.env.DUOPLUS_MOCK_MODE
    delete process.env.DUOPLUS_MOCK_URL
    delete process.env.DUOPLUS_API_KEY

    delete process.env.STORAGE_DRIVER

    resetStorageDriver()
    await mock.close()
  })

  // youtube (P4) и instagram (P8) реализованы — см. *-poster.spec.ts. tiktok НЕ
  // реализован (застрял на splash при калибровке).
  it.each<Platform>(["tiktok"])(
    "%s → POSTER_NOT_IMPLEMENTED (постер не реализован)",
    async (platform) => {
      const engine = new AdbAutomationEngine({
        powerOnPollIntervalMs: 1,
        powerOnTimeoutMs: 10_000,
        mediaPollIntervalMs: 1,
      })
      await expect(engine.postVideo(baseInput(platform))).rejects.toMatchObject({
        code: POSTER_NOT_IMPLEMENTED,
      })
    },
  )

  it("powerOff вызван в finally даже при ошибке постера", async () => {
    const engine = new AdbAutomationEngine({
      powerOnPollIntervalMs: 1,
      powerOnTimeoutMs: 10_000,
      mediaPollIntervalMs: 1,
    })
    // tiktok ещё не реализован → постер бросает → проверяем powerOff в finally.
    await expect(engine.postVideo(baseInput("tiktok"))).rejects.toBeInstanceOf(AdbEngineError)
    // После постинга устройство должно быть выключено (powerOff в finally).
    const dev = mock.devices.get(IMAGE_ID)!
    expect(dev.status).toBe(DUOPLUS_STATUS.OFF)
  })
})
