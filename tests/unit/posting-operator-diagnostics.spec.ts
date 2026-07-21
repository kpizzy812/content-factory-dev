/**
 * Unit-тесты operator-диагностики FSM (PR5A): buildFsmDiagnostics (API summary),
 * buildFsmLogData (канонический structured-лог), decisionToOperatorClass,
 * mapPersistedCategoryToOperatorClass.
 */
import { describe, expect, it } from "vitest"
import {
  buildFsmDiagnostics,
  buildFsmLogData,
  decisionToOperatorClass,
  mapPersistedCategoryToOperatorClass,
} from "../../server/utils/posting/operator-diagnostics"
import type { FsmFailureDecision } from "../../server/utils/posting/retry-policy"
import type { YouTubePostingStateData } from "../../shared/types/youtube-posting-fsm"

const WINDOW_MS = 90 * 60 * 1000

function makeState(over: Partial<YouTubePostingStateData> = {}): YouTubePostingStateData {
  return {
    fsmVersion: 1,
    buildMarker: "test-marker",
    currentPhase: "file_upload",
    progress: "file_attached_unconfirmed",
    draftVideoId: null,
    phaseAttempts: {},
    classWindows: {},
    lastTransitionAt: new Date().toISOString(),
    lastCompletedPhase: "open_upload_dialog",
    ...over,
  }
}

describe("buildFsmDiagnostics", () => {
  it("null если job не под FSM (нет fsmVersion)", () => {
    expect(buildFsmDiagnostics({ stateData: null, retryAt: null, status: "queued", errorCategory: null, lastErrorPhase: null })).toBeNull()
    expect(buildFsmDiagnostics({ stateData: { foo: 1 }, retryAt: null, status: "queued", errorCategory: null, lastErrorPhase: null })).toBeNull()
  })

  it("собирает summary для FSM-job с класс-окнами и draft", () => {
    const windowStartAt = new Date("2026-05-29T10:00:00.000Z").toISOString()
    const sd = makeState({
      draftVideoId: "vid_42",
      lastErrorClass: "indigo_unstable",
      lastErrorPhase: "session_start",
      finalReason: null,
      classWindows: {
        indigo_unstable: { count: 3, windowStartAt, alertedAt: windowStartAt, lastPhase: "session_start" },
      },
    })
    const out = buildFsmDiagnostics({
      stateData: sd,
      retryAt: new Date("2026-05-29T10:15:00.000Z"),
      status: "retry_queued",
      errorCategory: "browser_connect_failed",
      lastErrorPhase: "session_start",
    })!
    expect(out).not.toBeNull()
    expect(out.isFsmManaged).toBe(true)
    expect(out.fsmVersion).toBe(1)
    expect(out.currentPhase).toBe("file_upload")
    expect(out.lastCompletedPhase).toBe("open_upload_dialog")
    expect(out.draftVideoId).toBe("vid_42")
    expect(out.draftVideoIdPresent).toBe(true)
    expect(out.lastErrorClass).toBe("indigo_unstable")
    expect(out.operatorClass).toBe("indigo_unstable")
    expect(out.operatorAction).toBeTruthy()
    expect(out.operator?.severity).toBe("warning")
    expect(out.nextRetryAt).toBe("2026-05-29T10:15:00.000Z")
    // windowExpiresAt = windowStartAt + 90 мин
    const w = out.classWindows.find((c) => c.errorClass === "indigo_unstable")!
    expect(w.count).toBe(3)
    expect(w.windowExpiresAt).toBe(new Date(new Date(windowStartAt).getTime() + WINDOW_MS).toISOString())
  })

  it("draftVideoIdPresent=false когда draft не захвачен", () => {
    const out = buildFsmDiagnostics({ stateData: makeState(), retryAt: null, status: "uploading", errorCategory: null, lastErrorPhase: null })!
    expect(out.draftVideoIdPresent).toBe(false)
    expect(out.draftVideoId).toBeNull()
  })

  it("не отдаёт секретов (только FSM-поля)", () => {
    const out = buildFsmDiagnostics({ stateData: makeState({ lastErrorClass: "auth_required" }), retryAt: null, status: "failed", errorCategory: "login_required", lastErrorPhase: "login_check" })!
    const allowed = new Set([
      "isFsmManaged", "fsmVersion", "buildMarker", "currentPhase", "lastCompletedPhase",
      "progress", "lastErrorClass", "lastErrorPhase", "finalReason", "draftVideoId",
      "draftVideoIdPresent", "duplicateRiskAcknowledged", "classWindows", "nextRetryAt",
      "operatorClass", "operatorAction", "operator",
    ])
    for (const k of Object.keys(out)) expect(allowed.has(k), `unexpected key ${k}`).toBe(true)
    // Нет полей-носителей секретов (слово "cookie" в operatorAction — это инструкция, не секрет).
    expect(JSON.stringify(out)).not.toMatch(
      /accessToken|refreshToken|loginPassword|twoFASecret|recoveryEmail|recoveryPhone|proxyUrl|proxyPassword|"cookies"/i,
    )
  })
})

describe("buildFsmLogData — канонический shape", () => {
  it("содержит все обязательные поля", () => {
    const sd = makeState({ draftVideoId: "d1", draftUrl: "https://studio/x", duplicateRiskAcknowledged: true })
    const data = buildFsmLogData({
      jobId: "j1",
      phase: "file_upload",
      errorClass: "browser_lost",
      stateData: sd,
      retryCount: 2,
      retryAt: new Date("2026-05-29T11:00:00.000Z"),
    })
    for (const key of [
      "jobId", "phase", "currentPhase", "progress", "lastCompletedPhase", "errorClass",
      "retryCount", "retryAt", "windowStartAt", "windowExpiresAt", "finalReason",
      "operatorAction", "draftVideoId", "draftUrl", "duplicateRiskAcknowledged",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(data, key), key).toBe(true)
    }
    expect(data.jobId).toBe("j1")
    expect(data.errorClass).toBe("browser_lost")
    expect(data.retryCount).toBe(2)
    expect(data.retryAt).toBe("2026-05-29T11:00:00.000Z")
    expect(data.draftVideoId).toBe("d1")
    expect(data.draftUrl).toBe("https://studio/x")
    expect(data.duplicateRiskAcknowledged).toBe(true)
    expect(data.operatorAction).toBeTruthy()
  })

  it("windowExpiresAt считается из windowStartAt + windowMs класса", () => {
    const windowStartAt = "2026-05-29T10:00:00.000Z"
    const data = buildFsmLogData({ jobId: "j1", errorClass: "indigo_unstable", stateData: makeState(), windowStartAt })
    expect(data.windowExpiresAt).toBe(new Date(new Date(windowStartAt).getTime() + WINDOW_MS).toISOString())
  })
})

describe("decisionToOperatorClass / mapPersistedCategoryToOperatorClass", () => {
  it("windowed decisions → семантический класс", () => {
    const cw = {}
    const indigoRetry: FsmFailureDecision = { kind: "indigo_unstable_retry", persistedCategory: "browser_connect_failed", retryAt: new Date(), backoffMs: 0, priorRetries: 0, maxRetries: 7, windowElapsedMs: 0, alertNow: true, classWindows: cw }
    const blostFinal: FsmFailureDecision = { kind: "browser_lost_final", persistedCategory: "network_error", priorRetries: 5, windowElapsedMs: 0, classWindows: cw, finalReason: "browser_lost" }
    const dupFinal: FsmFailureDecision = { kind: "duplicate_risk_final", persistedCategory: "network_error", priorRetries: 5, windowElapsedMs: 0, classWindows: cw, finalReason: "duplicate_risk" }
    expect(decisionToOperatorClass(indigoRetry)).toBe("indigo_unstable")
    expect(decisionToOperatorClass(blostFinal)).toBe("browser_lost")
    expect(decisionToOperatorClass(dupFinal)).toBe("duplicate_risk")
  })

  it("terminal с finalReason=requires_human → requires_human; иначе маппинг категории", () => {
    const t1: FsmFailureDecision = { kind: "terminal", category: "account_locked", finalReason: "requires_human" }
    const t2: FsmFailureDecision = { kind: "terminal", category: "selector_not_found" }
    const gen: FsmFailureDecision = { kind: "generic_retry", category: "network_error", retryAt: new Date() }
    expect(decisionToOperatorClass(t1)).toBe("requires_human")
    expect(decisionToOperatorClass(t2)).toBe("selector_not_found")
    expect(decisionToOperatorClass(gen)).toBe("network_error")
  })

  it("persisted category mapping", () => {
    expect(mapPersistedCategoryToOperatorClass("proxy_dead")).toBe("proxy_dead")
    expect(mapPersistedCategoryToOperatorClass("auth_failed")).toBe("auth_required")
    expect(mapPersistedCategoryToOperatorClass("account_locked")).toBe("requires_human")
    expect(mapPersistedCategoryToOperatorClass("platform_5xx")).toBe("network_error")
    expect(mapPersistedCategoryToOperatorClass("internal_error")).toBe("unknown")
  })
})
