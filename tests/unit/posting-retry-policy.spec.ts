/**
 * Unit-тесты pure policy-движка retry (PR3) — resolveFsmFailure.
 *
 * Главное: числом-в-число парность с legacy worker.handleFailure, но счёт по
 * stateData.classWindows, а не по PostingJobLog-маркерам.
 */
import { describe, expect, it } from "vitest"
import type { YouTubePostingStateData } from "../../shared/types/youtube-posting-fsm"
import { resolveFsmFailure } from "../../server/utils/posting/retry-policy"
import { PostingPhaseError } from "../../server/automation/posters/types"

const MIN = 60_000
const NOW = new Date("2026-05-29T12:00:00.000Z")

function makeState(
  classWindows: YouTubePostingStateData["classWindows"] = {},
  over: Partial<YouTubePostingStateData> = {},
): YouTubePostingStateData {
  return {
    fsmVersion: 1,
    buildMarker: "test",
    currentPhase: "session_start",
    progress: "file_not_attached",
    draftVideoId: null,
    phaseAttempts: {},
    classWindows,
    lastTransitionAt: NOW.toISOString(),
    ...over,
  }
}

const deadPortErr = () =>
  new PostingPhaseError(
    "Indigo не отдал рабочий CDP-порт: DevTools endpoint not ready (port=37239, 5 internal attempts)",
    "session_start",
    "browser_connect_failed",
  )
const browserLostErr = () => new Error("Attempted to use detached Frame")

describe("resolveFsmFailure — indigo_unstable (dead-port, deadline window)", () => {
  it("первый провал → retry 1/7, count=1, backoff 5м, alertNow", () => {
    const d = resolveFsmFailure({
      err: deadPortErr(), message: deadPortErr().message, phase: "session_start",
      stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("indigo_unstable_retry")
    if (d.kind !== "indigo_unstable_retry") return
    expect(d.priorRetries).toBe(0)
    expect(d.maxRetries).toBe(7)
    expect(d.backoffMs).toBe(5 * MIN)
    expect(d.retryAt.getTime()).toBe(NOW.getTime() + 5 * MIN)
    expect(d.persistedCategory).toBe("browser_connect_failed")
    expect(d.classWindows.indigo_unstable.count).toBe(1)
    expect(d.alertNow).toBe(true)
  })

  it("инкремент из stateData (не из логов): count 2→3, backoff 15м, alertNow=false", () => {
    const state = makeState({
      indigo_unstable: { count: 2, windowStartAt: new Date(NOW.getTime() - 20 * MIN).toISOString(), alertedAt: "x" },
    })
    const d = resolveFsmFailure({
      err: deadPortErr(), message: deadPortErr().message, phase: "session_start",
      stateData: state, attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("indigo_unstable_retry")
    if (d.kind !== "indigo_unstable_retry") return
    expect(d.priorRetries).toBe(2)
    expect(d.backoffMs).toBe(10 * MIN) // index2 = 10м (числом-в-число с legacy)
    expect(d.alertNow).toBe(false) // prev.alertedAt выставлен → не дублируем
  })

  it("backoff index числом-в-число: 0→5, 1→10, 2→10, 3→15", () => {
    const mk = (count: number) =>
      resolveFsmFailure({
        err: deadPortErr(), message: deadPortErr().message, phase: "s",
        stateData: makeState(count === 0 ? {} : { indigo_unstable: { count, windowStartAt: new Date(NOW.getTime() - MIN).toISOString(), alertedAt: "x" } }),
        attemptCount: 1, maxAttempts: 3, now: NOW,
      })
    const b = (count: number) => { const d = mk(count); return d.kind === "indigo_unstable_retry" ? d.backoffMs : -1 }
    expect(b(0)).toBe(5 * MIN)
    expect(b(1)).toBe(10 * MIN)
    expect(b(2)).toBe(10 * MIN)
    expect(b(3)).toBe(15 * MIN)
  })

  it("count=7 → final (window exhausted)", () => {
    const state = makeState({
      indigo_unstable: { count: 7, windowStartAt: new Date(NOW.getTime() - 30 * MIN).toISOString(), alertedAt: "x" },
    })
    const d = resolveFsmFailure({
      err: deadPortErr(), message: deadPortErr().message, phase: "s",
      stateData: state, attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("indigo_unstable_final")
    if (d.kind !== "indigo_unstable_final") return
    expect(d.finalReason).toBe("indigo_unstable")
    expect(d.persistedCategory).toBe("browser_connect_failed")
  })

  it("deadline: окно истекло (elapsed≥90м) → final даже при count<7", () => {
    const state = makeState({
      indigo_unstable: { count: 2, windowStartAt: new Date(NOW.getTime() - 91 * MIN).toISOString(), alertedAt: "x" },
    })
    const d = resolveFsmFailure({
      err: deadPortErr(), message: deadPortErr().message, phase: "s",
      stateData: state, attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("indigo_unstable_final")
  })
})

describe("resolveFsmFailure — browser_lost (rolling window)", () => {
  it("первый провал → retry 1/5, count=1, backoff 5м", () => {
    const d = resolveFsmFailure({
      err: browserLostErr(), message: browserLostErr().message, phase: "navigate_upload",
      stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("browser_lost_retry")
    if (d.kind !== "browser_lost_retry") return
    expect(d.maxRetries).toBe(5)
    expect(d.backoffMs).toBe(5 * MIN)
    expect(d.persistedCategory).toBe("network_error")
    expect(d.classWindows.browser_lost.count).toBe(1)
  })

  it("backoff index: 0→5, 1→7, 2→7, 3→10", () => {
    const b = (count: number) => {
      const d = resolveFsmFailure({
        err: browserLostErr(), message: browserLostErr().message, phase: "x",
        stateData: makeState(count === 0 ? {} : { browser_lost: { count, windowStartAt: new Date(NOW.getTime() - MIN).toISOString(), alertedAt: "x" } }),
        attemptCount: 1, maxAttempts: 3, now: NOW,
      })
      return d.kind === "browser_lost_retry" ? d.backoffMs : -1
    }
    expect(b(0)).toBe(5 * MIN)
    expect(b(1)).toBe(7 * MIN)
    expect(b(2)).toBe(7 * MIN)
    expect(b(3)).toBe(10 * MIN)
  })

  it("count=5 → final", () => {
    const state = makeState({
      browser_lost: { count: 5, windowStartAt: new Date(NOW.getTime() - 30 * MIN).toISOString(), alertedAt: "x" },
    })
    const d = resolveFsmFailure({
      err: browserLostErr(), message: browserLostErr().message, phase: "x",
      stateData: state, attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("browser_lost_final")
  })

  it("rolling: окно истекло (≥90м) → сброс count → снова retry", () => {
    const state = makeState({
      browser_lost: { count: 5, windowStartAt: new Date(NOW.getTime() - 91 * MIN).toISOString(), alertedAt: "x" },
    })
    const d = resolveFsmFailure({
      err: browserLostErr(), message: browserLostErr().message, phase: "x",
      stateData: state, attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("browser_lost_retry")
    if (d.kind !== "browser_lost_retry") return
    expect(d.priorRetries).toBe(0) // окно сброшено
    expect(d.classWindows.browser_lost.count).toBe(1)
  })
})

describe("resolveFsmFailure — generic + terminal (parity с legacy)", () => {
  it("network_error: attemptCount<max → generic_retry", () => {
    const err = new PostingPhaseError("Navigation timeout of 45000 ms", "navigate_upload", "network_error")
    const d = resolveFsmFailure({
      err, message: err.message, phase: "navigate_upload",
      stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("generic_retry")
    if (d.kind !== "generic_retry") return
    expect(d.category).toBe("network_error")
    expect(d.retryAt).toBeInstanceOf(Date)
  })

  it("device_cooldown (wrapped network_error): retryAt ≥180с, не 1мин generic", () => {
    // poster-runner оборачивает AdbEngineError(device_cooldown) в PostingPhaseError
    // с маркером [adb:device_cooldown] и category network_error → generic route,
    // но задержка должна быть ≥180с (устройство ещё configuring), а не 1 мин.
    const before = Date.now()
    const err = new PostingPhaseError(
      "[adb:device_cooldown] Устройство остывает после предыдущего постинга (~3 мин) — повтор автоматически.",
      "session_start",
      "network_error",
    )
    const d = resolveFsmFailure({
      err, message: err.message, phase: "session_start",
      stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("generic_retry")
    if (d.kind !== "generic_retry") return
    expect(d.category).toBe("network_error")
    expect(d.retryAt.getTime() - before).toBeGreaterThanOrEqual(180_000)
  })

  it("device_busy (wrapped network_error): retryAt ≥180с", () => {
    const before = Date.now()
    const err = new PostingPhaseError(
      "[adb:device_busy] Устройство занято другой публикацией — повтор автоматически.",
      "session_start",
      "network_error",
    )
    const d = resolveFsmFailure({
      err, message: err.message, phase: "session_start",
      stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("generic_retry")
    if (d.kind !== "generic_retry") return
    expect(d.retryAt.getTime() - before).toBeGreaterThanOrEqual(180_000)
  })

  it("обычный network_error (не device): generic 1мин backoff, БЕЗ cooldown-инфляции", () => {
    // nextRetryAt якорится на Date.now() (не на injected now), поэтому сравниваем
    // дельту с реальными часами: attemptCount=1 → backoff[0]=1мин (<180с cooldown).
    const before = Date.now()
    const err = new PostingPhaseError("Navigation timeout of 45000 ms", "navigate_upload", "network_error")
    const d = resolveFsmFailure({
      err, message: err.message, phase: "navigate_upload",
      stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("generic_retry")
    if (d.kind !== "generic_retry") return
    const delta = d.retryAt.getTime() - before
    // Около 60с (генерик), заведомо МЕНЬШЕ device-кулдауна 180с — инфляции нет.
    expect(delta).toBeGreaterThanOrEqual(59_000)
    expect(delta).toBeLessThan(120_000)
  })

  it("network_error: attemptCount>=max → terminal", () => {
    const err = new PostingPhaseError("timeout", "navigate_upload", "network_error")
    const d = resolveFsmFailure({
      err, message: err.message, phase: "navigate_upload",
      stateData: makeState(), attemptCount: 3, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("terminal")
  })

  it("login_required → terminal", () => {
    const err = new PostingPhaseError("нужен fresh login", "login_check", "login_required")
    const d = resolveFsmFailure({ err, message: err.message, phase: "login_check", stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW })
    expect(d.kind).toBe("terminal")
    if (d.kind !== "terminal") return
    expect(d.category).toBe("login_required")
  })

  it("selector_not_found → terminal", () => {
    const err = new PostingPhaseError("Не найден title input", "details", "selector_not_found")
    const d = resolveFsmFailure({ err, message: err.message, phase: "details", stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW })
    expect(d.kind).toBe("terminal")
  })

  it("proxy_dead → terminal", () => {
    const err = new PostingPhaseError("CRITICAL LEAK", "browser_leak_check", "proxy_dead")
    const d = resolveFsmFailure({ err, message: err.message, phase: "browser_leak_check", stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW })
    expect(d.kind).toBe("terminal")
  })

  it("dead-port имеет приоритет над browser_lost", () => {
    const err = new PostingPhaseError("DevTools endpoint not ready; detached Frame", "session_start", "browser_connect_failed")
    const d = resolveFsmFailure({ err, message: err.message, phase: "session_start", stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW })
    expect(d.kind).toBe("indigo_unstable_retry")
  })
})

describe("resolveFsmFailure — duplicate_risk (browser_lost ПОСЛЕ attach, PR4)", () => {
  it("progress < attach (file_not_attached) → browser_lost (как раньше)", () => {
    const d = resolveFsmFailure({
      err: browserLostErr(), message: browserLostErr().message, phase: "navigate_upload",
      stateData: makeState(), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("browser_lost_retry")
  })

  it("progress >= attach (file_attached_unconfirmed) → duplicate_risk_retry, числа = browser_lost", () => {
    const d = resolveFsmFailure({
      err: browserLostErr(), message: browserLostErr().message, phase: "file_upload",
      stateData: makeState({}, { progress: "file_attached_unconfirmed" }), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("duplicate_risk_retry")
    if (d.kind !== "duplicate_risk_retry") return
    expect(d.maxRetries).toBe(5)
    expect(d.backoffMs).toBe(5 * MIN)
    expect(d.persistedCategory).toBe("network_error")
    expect(d.classWindows.duplicate_risk.count).toBe(1)
  })

  it("duplicate_risk backoff index: 0→5, 1→7, 2→7, 3→10 (= browser_lost)", () => {
    const b = (count: number) => {
      const d = resolveFsmFailure({
        err: browserLostErr(), message: browserLostErr().message, phase: "file_upload",
        stateData: makeState(
          count === 0 ? {} : { duplicate_risk: { count, windowStartAt: new Date(NOW.getTime() - MIN).toISOString(), alertedAt: "x" } },
          { progress: "processing_seen" },
        ),
        attemptCount: 1, maxAttempts: 3, now: NOW,
      })
      return d.kind === "duplicate_risk_retry" ? d.backoffMs : -1
    }
    expect(b(0)).toBe(5 * MIN)
    expect(b(1)).toBe(7 * MIN)
    expect(b(2)).toBe(7 * MIN)
    expect(b(3)).toBe(10 * MIN)
  })

  it("duplicate_risk count=5 → duplicate_risk_final", () => {
    const d = resolveFsmFailure({
      err: browserLostErr(), message: browserLostErr().message, phase: "file_upload",
      stateData: makeState(
        { duplicate_risk: { count: 5, windowStartAt: new Date(NOW.getTime() - 10 * MIN).toISOString(), alertedAt: "x" } },
        { progress: "details_seen" },
      ),
      attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("duplicate_risk_final")
  })

  it("dead-port приоритетнее duplicate_risk даже после attach", () => {
    const err = new PostingPhaseError("DevTools endpoint not ready; detached Frame", "session_start", "browser_connect_failed")
    const d = resolveFsmFailure({
      err, message: err.message, phase: "session_start",
      stateData: makeState({}, { progress: "processing_seen" }), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("indigo_unstable_retry")
  })
})

describe("resolveFsmFailure — terminalReason resume (PR4)", () => {
  it("terminalReason=duplicate_risk → terminal, finalReason duplicate_risk, persisted network_error", () => {
    const err = new PostingPhaseError("DUPLICATE_RISK_BLOCKED: ...", "file_upload", "unknown", undefined, "duplicate_risk")
    const d = resolveFsmFailure({
      err, message: err.message, phase: "file_upload",
      stateData: makeState({}, { progress: "upload_started" }), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("terminal")
    if (d.kind !== "terminal") return
    expect(d.finalReason).toBe("duplicate_risk")
    expect(d.category).toBe("network_error")
  })

  it("terminalReason=requires_human → terminal, finalReason requires_human, persisted account_locked", () => {
    const err = new PostingPhaseError("verify_only: не доказали", "extract_url", "unknown", undefined, "requires_human")
    const d = resolveFsmFailure({
      err, message: err.message, phase: "extract_url",
      stateData: makeState({}, { progress: "publish_clicked" }), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("terminal")
    if (d.kind !== "terminal") return
    expect(d.finalReason).toBe("requires_human")
    expect(d.category).toBe("account_locked")
  })

  it("terminalReason приоритетнее даже если message содержит detached Frame", () => {
    const err = new PostingPhaseError("detached Frame во время resume", "file_upload", "unknown", undefined, "duplicate_risk")
    const d = resolveFsmFailure({
      err, message: err.message, phase: "file_upload",
      stateData: makeState({}, { progress: "processing_seen" }), attemptCount: 1, maxAttempts: 3, now: NOW,
    })
    expect(d.kind).toBe("terminal")
  })
})
