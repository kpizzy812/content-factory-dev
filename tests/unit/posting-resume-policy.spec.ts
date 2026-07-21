/**
 * Unit-тесты pure resume-policy (PR4 duplicate-upload guard) — resolveResumePlan.
 *
 * Главное: при неуверенности → block (duplicate_blocked), надёжный resume только
 * по draftVideoId; после publish_clicked → только verify, никогда не republish.
 */
import { describe, expect, it } from "vitest"
import type {
  ResumePlan,
  YouTubePostingProgress,
  YouTubePostingStateData,
} from "../../shared/types/youtube-posting-fsm"
import {
  resolveResumePlan,
  resolveStuckUploadingAction,
  resumeAllowsUpload,
} from "../../server/utils/posting/resume-policy"

function makeState(over: Partial<YouTubePostingStateData> = {}): YouTubePostingStateData {
  return {
    fsmVersion: 1,
    buildMarker: "test",
    currentPhase: "file_upload",
    progress: "file_not_attached",
    draftVideoId: null,
    phaseAttempts: {},
    classWindows: {},
    lastTransitionAt: "2026-05-29T12:00:00.000Z",
    ...over,
  }
}

describe("resolveResumePlan — fresh (ничего не прикреплено)", () => {
  it("file_not_attached → fresh", () => {
    expect(resolveResumePlan(makeState({ progress: "file_not_attached" }))).toBe("fresh")
  })

  it("отсутствующий progress (legacy state) → fresh (защитно)", () => {
    const s = makeState()
    // @ts-expect-error — намеренно убираем progress, проверяем дефолт
    delete s.progress
    expect(resolveResumePlan(s)).toBe("fresh")
  })
})

describe("resolveResumePlan — file_attached_unconfirmed без draftVideoId", () => {
  it("re-upload не израсходован → reupload_once", () => {
    expect(
      resolveResumePlan(makeState({ progress: "file_attached_unconfirmed", duplicateRiskAcknowledged: false })),
    ).toBe("reupload_once")
  })

  it("duplicateRiskAcknowledged не задан (undefined) → reupload_once", () => {
    expect(resolveResumePlan(makeState({ progress: "file_attached_unconfirmed" }))).toBe("reupload_once")
  })

  it("re-upload уже израсходован → duplicate_blocked", () => {
    expect(
      resolveResumePlan(makeState({ progress: "file_attached_unconfirmed", duplicateRiskAcknowledged: true })),
    ).toBe("duplicate_blocked")
  })
})

describe("resolveResumePlan — upload пошёл, draftVideoId нет → duplicate_blocked", () => {
  const blockedProgresses: YouTubePostingProgress[] = ["upload_started", "processing_seen", "details_seen"]
  for (const p of blockedProgresses) {
    it(`${p} без draft → duplicate_blocked (слепой re-upload = дубль)`, () => {
      expect(resolveResumePlan(makeState({ progress: p, draftVideoId: null }))).toBe("duplicate_blocked")
    })
  }

  it("duplicateRiskAcknowledged=false НЕ разблокирует upload_started (re-upload только на attach-стадии)", () => {
    expect(
      resolveResumePlan(makeState({ progress: "upload_started", duplicateRiskAcknowledged: false })),
    ).toBe("duplicate_blocked")
  })
})

describe("resolveResumePlan — draftVideoId есть → resume_from_details (приоритет над re-upload)", () => {
  const withDraft: YouTubePostingProgress[] = [
    "file_attached_unconfirmed",
    "upload_started",
    "processing_seen",
    "details_seen",
  ]
  for (const p of withDraft) {
    it(`${p} + draftVideoId → resume_from_details (без re-upload)`, () => {
      expect(resolveResumePlan(makeState({ progress: p, draftVideoId: "dQw4w9WgXcQ" }))).toBe(
        "resume_from_details",
      )
    })
  }

  it("draftVideoId перебивает reupload_once на file_attached_unconfirmed", () => {
    const plan = resolveResumePlan(
      makeState({ progress: "file_attached_unconfirmed", draftVideoId: "abc", duplicateRiskAcknowledged: false }),
    )
    expect(plan).toBe("resume_from_details")
  })
})

describe("resolveResumePlan — publish_clicked/confirmed → verify_only (никогда не republish)", () => {
  it("publish_clicked без draft → verify_only", () => {
    expect(resolveResumePlan(makeState({ progress: "publish_clicked" }))).toBe("verify_only")
  })

  it("publish_confirmed → verify_only", () => {
    expect(resolveResumePlan(makeState({ progress: "publish_confirmed" }))).toBe("verify_only")
  })

  it("publish_clicked перебивает наличие draftVideoId (verify приоритетнее resume)", () => {
    expect(
      resolveResumePlan(makeState({ progress: "publish_clicked", draftVideoId: "abc" })),
    ).toBe("verify_only")
  })

  it("publish_clicked перебивает duplicateRiskAcknowledged", () => {
    expect(
      resolveResumePlan(makeState({ progress: "publish_clicked", duplicateRiskAcknowledged: true })),
    ).toBe("verify_only")
  })
})

describe("resumeAllowsUpload", () => {
  const cases: Array<[ResumePlan, boolean]> = [
    ["fresh", true],
    ["reupload_once", true],
    ["resume_from_details", false],
    ["verify_only", false],
    ["duplicate_blocked", false],
  ]
  for (const [plan, allowed] of cases) {
    it(`${plan} → ${allowed ? "разрешает" : "запрещает"} upload`, () => {
      expect(resumeAllowsUpload(plan)).toBe(allowed)
    })
  }
})

describe("resolveStuckUploadingAction (PR4 stuck-uploading recovery)", () => {
  const NOW2 = new Date("2026-05-29T13:00:00.000Z") // +60м к дефолтному lastTransitionAt
  const LIMIT = 25 * 60 * 1000
  // heartbeat 60м назад → stale при лимите 25м.
  const stale = (over: Partial<YouTubePostingStateData> = {}) =>
    makeState({ lastTransitionAt: "2026-05-29T12:00:00.000Z", ...over })

  it("non-FSM (stateData=null) → skip", () => {
    expect(resolveStuckUploadingAction(null, NOW2, LIMIT)).toBe("skip")
  })

  it("non-FSM (нет fsmVersion) → skip", () => {
    const sd = stale()
    delete (sd as Partial<YouTubePostingStateData>).fsmVersion
    expect(resolveStuckUploadingAction(sd, NOW2, LIMIT)).toBe("skip")
  })

  it("нет lastTransitionAt → skip (не трогаем legacy/битые данные)", () => {
    expect(resolveStuckUploadingAction(stale({ lastTransitionAt: "" }), NOW2, LIMIT)).toBe("skip")
  })

  it("свежий heartbeat (< лимита) → skip", () => {
    const fresh = makeState({ lastTransitionAt: new Date(NOW2.getTime() - 5 * 60_000).toISOString() })
    expect(resolveStuckUploadingAction(fresh, NOW2, LIMIT)).toBe("skip")
  })

  it("stale file_not_attached → retry_resume", () => {
    expect(resolveStuckUploadingAction(stale({ progress: "file_not_attached" }), NOW2, LIMIT)).toBe("retry_resume")
  })

  it("stale file_attached_unconfirmed → retry_resume", () => {
    expect(resolveStuckUploadingAction(stale({ progress: "file_attached_unconfirmed" }), NOW2, LIMIT)).toBe(
      "retry_resume",
    )
  })

  it("stale processing_seen / details_seen → retry_resume", () => {
    expect(resolveStuckUploadingAction(stale({ progress: "processing_seen" }), NOW2, LIMIT)).toBe("retry_resume")
    expect(resolveStuckUploadingAction(stale({ progress: "details_seen" }), NOW2, LIMIT)).toBe("retry_resume")
  })

  it("stale publish_clicked → requires_human (без retry/republish)", () => {
    expect(resolveStuckUploadingAction(stale({ progress: "publish_clicked" }), NOW2, LIMIT)).toBe("requires_human")
  })

  it("stale publish_confirmed → requires_human (no retry)", () => {
    expect(resolveStuckUploadingAction(stale({ progress: "publish_confirmed" }), NOW2, LIMIT)).toBe("requires_human")
  })

  it("env-override лимита: тот же возраст (60м), лимит 90м → skip, лимит 10м → срабатывает", () => {
    const sd = stale({ progress: "processing_seen" })
    expect(resolveStuckUploadingAction(sd, NOW2, 90 * 60_000)).toBe("skip")
    expect(resolveStuckUploadingAction(sd, NOW2, 10 * 60_000)).toBe("retry_resume")
  })
})
