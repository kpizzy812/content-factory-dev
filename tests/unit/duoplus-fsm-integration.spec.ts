/**
 * Unit-тесты FSM-интеграции DuoPlus-движка (Этап 3, P5).
 *
 * Проверяют склейку runBrowserPosting ↔ AdbAutomationEngine за канареечным гейтом
 * DUOPLUS_ENGINE_ENABLED:
 *   - гейт OFF (default) → terminal engine_not_implemented (поведение Этапа 2).
 *   - гейт ON + youtube  → полный flow через mock-устройство → published (success).
 *   - гейт ON + tiktok   → poster_not_implemented → terminal internal_error (IG реализован в P8).
 *   - гейт ON без device  → terminal internal_error (устройство не привязано).
 *   - классификация AdbEngineError (terminal→internal_error, retryable→network_error).
 *
 * prisma (deviceProfile/video) и job-service (appendJobLog) замоканы; device-flow
 * идёт против реального in-process mock-сервера DuoPlus (как youtube-poster.spec).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const deviceProfileFindUnique = vi.hoisted(() => vi.fn())
const videoFindUnique = vi.hoisted(() => vi.fn())
const socialAccountFindUnique = vi.hoisted(() => vi.fn())
const appendJobLogMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock("../../server/utils/prisma", () => ({
  prisma: {
    deviceProfile: { findUnique: deviceProfileFindUnique },
    video: { findUnique: videoFindUnique },
    // runBrowserPosting резолвит platformHandle для best-effort захвата URL поста.
    socialAccount: { findUnique: socialAccountFindUnique },
  },
}))
vi.mock("../../server/utils/posting/job-service", () => ({
  appendJobLog: appendJobLogMock,
}))

import {
  createDuoplusMockServer,
  DUOPLUS_STATUS,
  type DuoplusMockHandle,
} from "../../server/__mocks__/duoplus-server"
import { resetDuoplusClient } from "../../server/utils/posting-provider/duoplus-client"
import { getStorageDriver, resetStorageDriver } from "../../server/utils/storage"
import {
  runBrowserPosting,
  type RunBrowserPostingInput,
} from "../../server/automation/poster-runner"
import {
  adbEngineCategory,
  categorizeError,
  isDeviceCooldownError,
} from "../../server/utils/posting/error-classifier"
import { POSTING_RETRYABLE_CATEGORIES } from "../../server/utils/posting/state-machine"
import { PostingPhaseError } from "../../server/automation/posters/types"
import {
  AdbEngineError,
  DEVICE_BUSY,
  DEVICE_CONFIG_ERROR,
  DEVICE_COOLDOWN,
  DEVICE_POWER_FAILED,
  MEDIA_PUSH_FAILED,
  POSTER_NOT_IMPLEMENTED,
} from "../../server/automation/automation-engine/adb-automation-engine"
import type { Platform } from "../../app/generated/prisma/enums"

const API_KEY = "test-key-from-env"
const IMAGE_ID = "M2Hxh"
const DEVICE_PROFILE_ID = "dp-1"

function setMockEnv(baseUrl: string): void {
  process.env.DUOPLUS_MOCK_MODE = "true"
  process.env.DUOPLUS_MOCK_URL = baseUrl
  process.env.DUOPLUS_API_KEY = API_KEY
  process.env.STORAGE_DRIVER = "mock"
  // Быстрые поллы движка (override только в mock-режиме).
  process.env.DUOPLUS_POWER_ON_POLL_MS = "1"
  process.env.DUOPLUS_POWER_ON_TIMEOUT_MS = "10000"
  process.env.DUOPLUS_MEDIA_POLL_MS = "1"
  // Быстрые тайминги YouTube-постера (waitUploadComplete/verify) — иначе appearMs
  // 45с блокирует полный flow дольше test-timeout.
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
  delete process.env.DUOPLUS_ENGINE_ENABLED
  delete process.env.DUOPLUS_POWER_ON_POLL_MS
  delete process.env.DUOPLUS_POWER_ON_TIMEOUT_MS
  delete process.env.DUOPLUS_MEDIA_POLL_MS
  delete process.env.YT_UPLOAD_APPEAR_MS
  delete process.env.YT_UPLOAD_FALLBACK_MS
  delete process.env.YT_UPLOAD_WAIT_MS
  delete process.env.YT_UPLOAD_POLL_MS
  resetStorageDriver()
}

function ytInput(overrides: Partial<RunBrowserPostingInput> = {}): RunBrowserPostingInput {
  return {
    jobId: "job-1",
    videoId: 1,
    socialAccountId: 2,
    deviceProfileId: DEVICE_PROFILE_ID,
    caption: "DuoPlus autopost test",
    title: "DuoPlus autopost test",
    platform: "youtube",
    ...overrides,
  }
}

/**
 * Кладёт видео в mock storage (push-модель: движок скачивает из GCS в tmp перед
 * заливкой через Cloud Drive). storageKey совпадает с Video.storageKey мока.
 * Вызывать ПОСЛЕ setMockEnv (resetStorageDriver даёт чистый MockDriver).
 */
async function seedVideo(): Promise<void> {
  await getStorageDriver().uploadBuffer(
    "zavodcamp/videos/job-1.mp4",
    Buffer.alloc(1024, 1),
    { contentType: "video/mp4" },
  )
}

beforeEach(() => {
  deviceProfileFindUnique.mockReset()
  videoFindUnique.mockReset()
  socialAccountFindUnique.mockReset()
  appendJobLogMock.mockClear()
  // По умолчанию устройство привязано и видео имеет storageKey.
  deviceProfileFindUnique.mockResolvedValue({ indigoId: IMAGE_ID })
  videoFindUnique.mockResolvedValue({ storageKey: "zavodcamp/videos/job-1.mp4" })
  // platformHandle=null → best-effort захват URL короткозамкнут без сетевого fetch
  // (тест герметичен). Тесты захвата URL переопределяют значение точечно.
  socialAccountFindUnique.mockResolvedValue({ platformHandle: null })
})

afterEach(() => {
  clearMockEnv()
})

describe("runBrowserPosting: гейт DUOPLUS_ENGINE_ENABLED OFF (Этап 2)", () => {
  it("без гейта → terminal engine_not_implemented (requires_human)", async () => {
    // Гейт не выставлен (== не 'true') → NotImplementedAutomationEngine.
    delete process.env.DUOPLUS_ENGINE_ENABLED
    const result = runBrowserPosting(ytInput())
    await expect(result).rejects.toBeInstanceOf(PostingPhaseError)
    await expect(result).rejects.toMatchObject({
      terminalReason: "requires_human",
    })
    // prisma НЕ дёргается (device-context резолвится только за гейтом ON).
    expect(deviceProfileFindUnique).not.toHaveBeenCalled()
  })

  it("гейт OFF не ломает существующее поведение (engine_not_implemented в сообщении)", async () => {
    process.env.DUOPLUS_ENGINE_ENABLED = "false"
    await expect(runBrowserPosting(ytInput())).rejects.toThrow(/не реализован|DuoPlus/i)
  })
})

describe("runBrowserPosting: гейт ON + youtube → published (mock)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
    process.env.DUOPLUS_ENGINE_ENABLED = "true"
    await seedVideo()
  })

  afterEach(async () => {
    await mock.close()
  })

  it("проходит полный device-flow и возвращает успех", async () => {
    const result = await runBrowserPosting(ytInput())
    expect(result).toEqual({
      platformPostId: "",
      platformPostUrl: "",
      apiMadeWarning: false,
    })
    // powerOff в finally → устройство выключено.
    expect(mock.devices.get(IMAGE_ID)!.status).toBe(DUOPLUS_STATUS.OFF)
    // image_id зарезолвлен из DeviceProfile.indigoId, storageKey из Video.
    expect(deviceProfileFindUnique).toHaveBeenCalledWith({
      where: { id: DEVICE_PROFILE_ID },
      select: { indigoId: true },
    })
    expect(videoFindUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { storageKey: true },
    })
  })
})

describe("runBrowserPosting: гейт ON, terminal-ошибки → НЕ retryable", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    setMockEnv(mock.baseUrl)
    process.env.DUOPLUS_ENGINE_ENABLED = "true"
    await seedVideo()
  })

  afterEach(async () => {
    await mock.close()
  })

  // instagram реализован (P8) — здесь только tiktok (застрял на splash, не калиброван).
  it.each<Platform>(["tiktok"])(
    "%s → poster_not_implemented → terminal (internal_error, requires_human)",
    async (platform) => {
      const result = runBrowserPosting(
        ytInput({ platform, title: undefined, caption: "cap" }),
      )
      await expect(result).rejects.toBeInstanceOf(PostingPhaseError)
      const err = await result.catch((e) => e as PostingPhaseError)
      expect(err.category).toBe("internal_error")
      expect(err.terminalReason).toBe("requires_human")
      // categorizeError классифицирует обёрнутую ошибку как terminal internal_error.
      expect(categorizeError(err)).toBe("internal_error")
      // устройство выключено в finally.
      expect(mock.devices.get(IMAGE_ID)!.status).toBe(DUOPLUS_STATUS.OFF)
    },
  )

  it("device не привязан (deviceProfileId=null) → terminal internal_error, prisma video не читается", async () => {
    const result = runBrowserPosting(ytInput({ deviceProfileId: null }))
    await expect(result).rejects.toMatchObject({
      category: "internal_error",
      terminalReason: "requires_human",
    })
    expect(videoFindUnique).not.toHaveBeenCalled()
  })

  it("у устройства нет image_id (indigoId=null) → terminal internal_error", async () => {
    deviceProfileFindUnique.mockResolvedValue({ indigoId: null })
    await expect(runBrowserPosting(ytInput())).rejects.toMatchObject({
      category: "internal_error",
      terminalReason: "requires_human",
    })
  })

  it("у видео нет storageKey → terminal internal_error (фаза file_upload)", async () => {
    videoFindUnique.mockResolvedValue({ storageKey: null })
    await expect(runBrowserPosting(ytInput())).rejects.toMatchObject({
      category: "internal_error",
      phase: "file_upload",
      terminalReason: "requires_human",
    })
  })
})

describe("adbEngineCategory + categorizeError: классификация AdbEngineError", () => {
  it("terminal-коды → internal_error (НЕ retryable)", () => {
    expect(adbEngineCategory(DEVICE_CONFIG_ERROR, true)).toBe("internal_error")
    expect(adbEngineCategory(POSTER_NOT_IMPLEMENTED, true)).toBe("internal_error")
  })

  it("retryable-коды → network_error (входит в RETRYABLE_CATEGORIES)", () => {
    expect(adbEngineCategory(DEVICE_POWER_FAILED, false)).toBe("network_error")
    expect(adbEngineCategory(MEDIA_PUSH_FAILED, false)).toBe("network_error")
  })

  it("сырой AdbEngineError классифицируется по terminal-флагу", () => {
    const terminal = new AdbEngineError("config", DEVICE_CONFIG_ERROR, true)
    const retryable = new AdbEngineError("power", DEVICE_POWER_FAILED, false)
    expect(categorizeError(terminal)).toBe("internal_error")
    expect(categorizeError(retryable)).toBe("network_error")
  })

  it("device_busy / device_cooldown → network_error retryable (авто-повтор, не fail)", () => {
    const busy = new AdbEngineError("busy", DEVICE_BUSY, false)
    const cooldown = new AdbEngineError("cooldown", DEVICE_COOLDOWN, false)
    expect(adbEngineCategory(DEVICE_BUSY, false)).toBe("network_error")
    expect(adbEngineCategory(DEVICE_COOLDOWN, false)).toBe("network_error")
    expect(categorizeError(busy)).toBe("network_error")
    expect(categorizeError(cooldown)).toBe("network_error")
  })

  it("isDeviceCooldownError: сырой AdbEngineError + обёрнутый [adb:*] маркер", () => {
    // Сырой движковый код.
    expect(isDeviceCooldownError(new AdbEngineError("x", DEVICE_BUSY, false))).toBe(true)
    expect(isDeviceCooldownError(new AdbEngineError("x", DEVICE_COOLDOWN, false))).toBe(true)
    // Обёртка poster-runner [adb:<code>] в message PostingPhaseError.
    expect(
      isDeviceCooldownError(
        new PostingPhaseError("[adb:device_cooldown] остывает", "session_start", "network_error"),
      ),
    ).toBe(true)
    expect(
      isDeviceCooldownError(
        new PostingPhaseError("[adb:device_busy] занято", "session_start", "network_error"),
      ),
    ).toBe(true)
    // Прочие ошибки — false.
    expect(isDeviceCooldownError(new AdbEngineError("x", DEVICE_POWER_FAILED, false))).toBe(false)
    expect(isDeviceCooldownError(new Error("Navigation timeout"))).toBe(false)
  })
})

describe("categorizeError: детерминированный код-баг устройства НЕ retryable (защита денег)", () => {
  it("Android-исключение (NPE / InputShellCommand) → internal_error (terminal)", () => {
    // input text NPE на кириллице — детерминированный баг, повтор бессмыслен.
    const npe = new Error(
      "agentError: ExecError: java.lang.NullPointerException: Attempt to get length of " +
        "null array at com.android.server.input.InputShellCommand.sendText",
    )
    expect(categorizeError(npe)).toBe("internal_error")
    // internal_error НЕ входит в RETRYABLE_CATEGORIES → джоба не будит телефон 5 раз.
    expect(POSTING_RETRYABLE_CATEGORIES.includes("internal_error")).toBe(false)
  })

  it("NPE в .content DuoplusCommandError-объекта (stdout устройства) → internal_error", () => {
    const cmdErr = {
      name: "DuoplusCommandError",
      message: "sshExecError",
      content: "ExecError:\njava.lang.NullPointerException in InputShellCommand.sendText",
    }
    expect(categorizeError(cmdErr)).toBe("internal_error")
  })

  it("чистый sshExecError без Android-исключения остаётся retryable (network_error)", () => {
    // Транзиентный сбой команды (устройство занято) — повтор помогает, НЕ терминально.
    expect(categorizeError(new Error("agentError: sshExecError: command timed out"))).toBe(
      "network_error",
    )
  })
})
