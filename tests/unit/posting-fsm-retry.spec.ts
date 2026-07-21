/**
 * Unit-тесты impure-слоя policy-retry (PR3) — fsmHandleFailure.
 *
 * Проверяем branch (no stateData → legacy), cancelled, dead-port retry через
 * classWindows, и Telegram-троттлинг по alertedAt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { YouTubePostingStateData } from "../../shared/types/youtube-posting-fsm"

const findUniqueMock = vi.hoisted(() => vi.fn())
const transitionJobMock = vi.hoisted(() => vi.fn(async () => ({})))
const appendJobLogMock = vi.hoisted(() => vi.fn(async () => {}))
const sendTelegramAlertMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock("../../server/utils/prisma", () => ({
  prisma: { postingJob: { findUnique: findUniqueMock } },
}))
vi.mock("../../server/utils/posting/job-service", () => ({
  transitionJob: transitionJobMock,
  appendJobLog: appendJobLogMock,
}))
vi.mock("../../server/utils/telegram/alerts", () => ({
  sendTelegramAlert: sendTelegramAlertMock,
}))

import { fsmHandleFailure } from "../../server/utils/posting/fsm-retry"
import { PostingPhaseError } from "../../server/automation/posters/types"

const MIN = 60_000
const job = { id: "j1", attemptCount: 1, maxAttempts: 3, platform: "youtube", socialAccount: { id: 2, displayName: "Test YT 1" } }

function makeState(classWindows: YouTubePostingStateData["classWindows"] = {}): YouTubePostingStateData {
  return {
    fsmVersion: 1, buildMarker: "t", currentPhase: "session_start", progress: "file_not_attached",
    draftVideoId: null, phaseAttempts: {}, classWindows, lastTransitionAt: new Date().toISOString(),
  }
}
const deadPort = () => new PostingPhaseError("DevTools endpoint not ready (port=37239)", "session_start", "browser_connect_failed")

function lastTransition() {
  const c = transitionJobMock.mock.calls.at(-1)
  return { id: c?.[0], status: c?.[1], patch: c?.[2] as { stateData?: YouTubePostingStateData; errorCategory?: string; retryAt?: Date } }
}

describe("fsmHandleFailure — branch", () => {
  beforeEach(() => {
    findUniqueMock.mockReset(); transitionJobMock.mockClear(); appendJobLogMock.mockClear(); sendTelegramAlertMock.mockClear()
  })
  afterEach(() => vi.clearAllMocks())

  it("нет stateData → false (legacy path), без transition", async () => {
    findUniqueMock.mockResolvedValue({ status: "uploading", stateData: null })
    const handled = await fsmHandleFailure(job, deadPort())
    expect(handled).toBe(false)
    expect(transitionJobMock).not.toHaveBeenCalled()
  })

  it("cancelled → true (handled), без transition", async () => {
    findUniqueMock.mockResolvedValue({ status: "cancelled", stateData: makeState() })
    const handled = await fsmHandleFailure(job, deadPort())
    expect(handled).toBe(true)
    expect(transitionJobMock).not.toHaveBeenCalled()
  })
})

describe("fsmHandleFailure — indigo_unstable через classWindows", () => {
  beforeEach(() => {
    findUniqueMock.mockReset(); transitionJobMock.mockClear(); appendJobLogMock.mockClear(); sendTelegramAlertMock.mockClear()
  })
  afterEach(() => vi.clearAllMocks())

  it("первый dead-port → retry_queued, classWindows.count=1, TG custom один раз", async () => {
    findUniqueMock.mockResolvedValue({ status: "uploading", stateData: makeState() })
    const handled = await fsmHandleFailure(job, deadPort())
    expect(handled).toBe(true)
    const t = lastTransition()
    expect(t.status).toBe("retry_queued")
    expect(t.patch.errorCategory).toBe("browser_connect_failed")
    expect(t.patch.retryAt).toBeInstanceOf(Date)
    expect(t.patch.stateData?.classWindows?.indigo_unstable?.count).toBe(1)
    // TG custom один раз (первый в окне)
    const customCalls = sendTelegramAlertMock.mock.calls.filter((c) => c[0] === "custom")
    expect(customCalls).toHaveLength(1)
  })

  it("alertedAt уже выставлен → НЕ дублирует custom-нотификацию", async () => {
    findUniqueMock.mockResolvedValue({
      status: "uploading",
      stateData: makeState({
        indigo_unstable: { count: 1, windowStartAt: new Date(Date.now() - 5 * MIN).toISOString(), alertedAt: new Date(Date.now() - 5 * MIN).toISOString() },
      }),
    })
    const handled = await fsmHandleFailure(job, deadPort())
    expect(handled).toBe(true)
    expect(lastTransition().status).toBe("retry_queued")
    expect(lastTransition().patch.stateData?.classWindows?.indigo_unstable?.count).toBe(2)
    const customCalls = sendTelegramAlertMock.mock.calls.filter((c) => c[0] === "custom")
    expect(customCalls).toHaveLength(0)
  })

  it("count=7 → failed + critical_error", async () => {
    findUniqueMock.mockResolvedValue({
      status: "uploading",
      stateData: makeState({
        indigo_unstable: { count: 7, windowStartAt: new Date(Date.now() - 20 * MIN).toISOString(), alertedAt: "x" },
      }),
    })
    const handled = await fsmHandleFailure(job, deadPort())
    expect(handled).toBe(true)
    expect(lastTransition().status).toBe("failed")
    expect(lastTransition().patch.stateData?.finalReason).toBe("indigo_unstable")
    const crit = sendTelegramAlertMock.mock.calls.filter((c) => c[0] === "critical_error")
    expect(crit).toHaveLength(1)
  })
})

// --- PR5A: notification throttle observability + operator diagnostics ---

const browserLost = () => new PostingPhaseError("Attempted to use detached Frame", "navigate_upload", "unknown")
const networkErr = () => new PostingPhaseError("ETIMEDOUT during navigate", "navigate_upload", "network_error")
const dupBlocked = () =>
  new PostingPhaseError("DUPLICATE_RISK_BLOCKED: небезопасный re-upload", "file_upload", "unknown", undefined, "duplicate_risk")

function logMessages(): string[] {
  return appendJobLogMock.mock.calls.map((c) => String(c?.[2]))
}
function customCount(): number {
  return sendTelegramAlertMock.mock.calls.filter((c) => c[0] === "custom").length
}
function criticalCount(): number {
  return sendTelegramAlertMock.mock.calls.filter((c) => c[0] === "critical_error").length
}

describe("fsmHandleFailure — PR5A throttle + diagnostics", () => {
  beforeEach(() => {
    findUniqueMock.mockReset(); transitionJobMock.mockClear(); appendJobLogMock.mockClear(); sendTelegramAlertMock.mockClear()
  })
  afterEach(() => vi.clearAllMocks())

  it("FSM_POLICY_DECISION пишется на каждое решение", async () => {
    findUniqueMock.mockResolvedValue({ status: "uploading", stateData: makeState() })
    await fsmHandleFailure(job, deadPort())
    expect(logMessages().some((m) => m.startsWith("FSM_POLICY_DECISION"))).toBe(true)
  })

  it("новый класс на том же job → новая custom-нотификация (browser_lost при alerted indigo)", async () => {
    findUniqueMock.mockResolvedValue({
      status: "uploading",
      stateData: makeState({
        indigo_unstable: { count: 2, windowStartAt: new Date(Date.now() - 5 * MIN).toISOString(), alertedAt: new Date().toISOString() },
      }),
    })
    const handled = await fsmHandleFailure(job, browserLost())
    expect(handled).toBe(true)
    expect(lastTransition().status).toBe("retry_queued")
    expect(lastTransition().patch.stateData?.classWindows?.browser_lost?.count).toBe(1)
    // browser_lost — новый класс в окне → custom один раз; throttle НЕ срабатывает.
    expect(customCount()).toBe(1)
    expect(logMessages().some((m) => m.startsWith("FSM_NOTIFICATION_THROTTLED"))).toBe(false)
  })

  it("повтор того же класса с alerted → throttled, custom не дублируется", async () => {
    findUniqueMock.mockResolvedValue({
      status: "uploading",
      stateData: makeState({
        browser_lost: { count: 1, windowStartAt: new Date(Date.now() - 3 * MIN).toISOString(), alertedAt: new Date(Date.now() - 3 * MIN).toISOString() },
      }),
    })
    const handled = await fsmHandleFailure(job, browserLost())
    expect(handled).toBe(true)
    expect(customCount()).toBe(0)
    expect(logMessages().some((m) => m.startsWith("FSM_NOTIFICATION_THROTTLED"))).toBe(true)
  })

  it("generic retry (network_error, attempts<max) → нет critical и нет custom", async () => {
    findUniqueMock.mockResolvedValue({ status: "uploading", stateData: makeState() })
    const handled = await fsmHandleFailure(job, networkErr())
    expect(handled).toBe(true)
    expect(lastTransition().status).toBe("retry_queued")
    expect(criticalCount()).toBe(0)
    expect(customCount()).toBe(0)
  })

  it("duplicate_risk blocked (terminalReason) → failed + critical + FSM_OPERATOR_ACTION", async () => {
    findUniqueMock.mockResolvedValue({
      status: "uploading",
      stateData: makeState({}),
    })
    const handled = await fsmHandleFailure(job, dupBlocked())
    expect(handled).toBe(true)
    expect(lastTransition().status).toBe("failed")
    expect(lastTransition().patch.stateData?.finalReason).toBe("duplicate_risk")
    expect(criticalCount()).toBe(1)
    // FSM_OPERATOR_ACTION + FSM_FINAL_REASON на терминале
    expect(logMessages().some((m) => m.startsWith("FSM_OPERATOR_ACTION"))).toBe(true)
    expect(logMessages().some((m) => m.startsWith("FSM_FINAL_REASON"))).toBe(true)
    // critical-текст несёт операторское действие (не делать слепой re-upload)
    const crit = sendTelegramAlertMock.mock.calls.find((c) => c[0] === "critical_error")
    expect(String(crit?.[2])).toMatch(/Действие:/)
  })
})
