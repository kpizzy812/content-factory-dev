/**
 * Unit-тесты PR2A observability-наблюдателя (fsm-observer.ts).
 *
 * Ключевое:
 *   - flag OFF → NOOP: НИ ОДНОГО запроса к БД / записи в лог.
 *   - flag ON → корректный merge stateData + STATE_ENTER/EXIT/FAIL/PROGRESS.
 *   - cleanup (housekeeping) → log-only, не мутирует currentPhase/lastCompletedPhase.
 *   - best-effort: ошибка БД не пробрасывается наружу.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { YouTubePostingStateData } from "../../shared/types/youtube-posting-fsm"

const findUniqueMock = vi.hoisted(() => vi.fn())
const updateMock = vi.hoisted(() => vi.fn(async () => ({})))
const appendJobLogMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock("../../server/utils/prisma", () => ({
  prisma: {
    postingJob: { findUnique: findUniqueMock, update: updateMock },
  },
}))
vi.mock("../../server/utils/posting/job-service", () => ({
  appendJobLog: appendJobLogMock,
}))

import {
  createPhaseObserver,
  isYoutubePostingFsmEnabled,
  mapPostingPhaseToFsmPhase,
} from "../../server/utils/posting/fsm-observer"

const FLAG = "YOUTUBE_POSTING_FSM_ENABLED"

/** Прочитать stateData, записанный последним update. */
function lastWrittenState(): YouTubePostingStateData {
  const call = updateMock.mock.calls.at(-1)
  return (call?.[0] as { data: { stateData: YouTubePostingStateData } }).data.stateData
}

describe("createPhaseObserver — FSM OFF (no-op)", () => {
  beforeEach(() => {
    // PR5B: code default ON, поэтому OFF задаём явным rollback-флагом.
    process.env[FLAG] = "false"
    delete process.env.YOUTUBE_POSTING_FSM_DEFAULT
    findUniqueMock.mockReset()
    updateMock.mockClear()
    appendJobLogMock.mockClear()
  })
  afterEach(() => {
    delete process.env[FLAG]
  })

  it("enabled=false и НИ ОДНОГО побочного вызова", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    expect(fsm.enabled).toBe(false)
    expect(isYoutubePostingFsmEnabled()).toBe(false)

    await fsm.enterPhase("session_start")
    await fsm.exitPhase("session_start")
    await fsm.failPhase("navigate_upload", new Error("boom"))
    await fsm.updateProgress("upload_started")
    await fsm.markFileAttached()
    await fsm.captureDraft("vid123", "https://studio.youtube.com/video/vid123/edit")
    await fsm.markPublishClicked()
    await fsm.acknowledgeDuplicateRisk()
    await fsm.setUploadMeta("fp16", "v.mp4")

    expect(findUniqueMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    expect(appendJobLogMock).not.toHaveBeenCalled()
  })
})

describe("createPhaseObserver — flag ON", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
    findUniqueMock.mockReset()
    updateMock.mockClear()
    appendJobLogMock.mockClear()
    // По умолчанию — пустой stateData (первый вход).
    findUniqueMock.mockResolvedValue({ stateData: null })
  })
  afterEach(() => {
    delete process.env[FLAG]
  })

  it("enabled=true", () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    expect(fsm.enabled).toBe(true)
  })

  it("PR5B platform-gate: non-youtube → NOOP даже при FSM ON", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm", platform: "tiktok" })
    expect(fsm.enabled).toBe(false)
    expect(isYoutubePostingFsmEnabled("tiktok")).toBe(false)
    await fsm.enterPhase("session_start")
    expect(updateMock).not.toHaveBeenCalled()
    expect(appendJobLogMock).not.toHaveBeenCalled()
  })

  it("PR5B platform-gate: youtube → enabled при FSM ON", () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm", platform: "youtube" })
    expect(fsm.enabled).toBe(true)
  })

  it("enterPhase: currentPhase + phaseAttempts++ + STATE_ENTER лог", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm-123" })
    await fsm.enterPhase("session_start")

    expect(updateMock).toHaveBeenCalledOnce()
    const state = lastWrittenState()
    expect(state.fsmVersion).toBe(1)
    expect(state.buildMarker).toBe("bm-123")
    expect(state.currentPhase).toBe("session_start")
    expect(state.phaseAttempts.session_start).toBe(1)
    expect(typeof state.lastTransitionAt).toBe("string")

    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "info",
      "STATE_ENTER session_start",
      expect.objectContaining({ fsm: true, event: "STATE_ENTER", phase: "session_start", attempt: 1 }),
    )
  })

  it("enterPhase повторно инкрементит phaseAttempts (retry)", async () => {
    findUniqueMock.mockResolvedValue({
      stateData: {
        fsmVersion: 1,
        buildMarker: "bm",
        currentPhase: "session_start",
        progress: "file_not_attached",
        draftVideoId: null,
        phaseAttempts: { session_start: 1 },
        classWindows: {},
        lastTransitionAt: new Date().toISOString(),
      } satisfies YouTubePostingStateData,
    })
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.enterPhase("session_start")
    expect(lastWrittenState().phaseAttempts.session_start).toBe(2)
  })

  it("exitPhase: lastCompletedPhase + STATE_EXIT", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.exitPhase("login_check")
    expect(lastWrittenState().lastCompletedPhase).toBe("login_check")
    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "info",
      "STATE_EXIT login_check",
      expect.objectContaining({ event: "STATE_EXIT", phase: "login_check" }),
    )
  })

  it("failPhase: currentPhase + STATE_FAIL с errorClass (классификация, без влияния на retry)", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.failPhase("navigate_upload", new Error("Attempted to use detached Frame"))

    expect(lastWrittenState().currentPhase).toBe("navigate_upload")
    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "error",
      "STATE_FAIL navigate_upload",
      expect.objectContaining({
        event: "STATE_FAIL",
        phase: "navigate_upload",
        errorClass: "browser_lost", // detached Frame до attach (progress=file_not_attached)
      }),
    )
  })

  it("updateProgress: progress + STATE_PROGRESS", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.updateProgress("upload_started")
    expect(lastWrittenState().progress).toBe("upload_started")
    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "info",
      "STATE_PROGRESS upload_started",
      expect.objectContaining({ event: "STATE_PROGRESS", progress: "upload_started" }),
    )
  })

  it("markFileAttached: progress=file_attached_unconfirmed + fileAttachedAt", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.markFileAttached()
    const state = lastWrittenState()
    expect(state.progress).toBe("file_attached_unconfirmed")
    expect(typeof state.fileAttachedAt).toBe("string")
    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "info",
      "STATE_PROGRESS file_attached_unconfirmed",
      expect.objectContaining({ event: "STATE_PROGRESS", progress: "file_attached_unconfirmed" }),
    )
  })

  it("captureDraft: draftVideoId + draftUrl + DRAFT_ID_CAPTURED", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.captureDraft("dQw4w9WgXcQ", "https://studio.youtube.com/video/dQw4w9WgXcQ/edit")
    const state = lastWrittenState()
    expect(state.draftVideoId).toBe("dQw4w9WgXcQ")
    expect(state.draftUrl).toBe("https://studio.youtube.com/video/dQw4w9WgXcQ/edit")
    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "info",
      "DRAFT_ID_CAPTURED dQw4w9WgXcQ",
      expect.objectContaining({ event: "DRAFT_ID_CAPTURED", draftVideoId: "dQw4w9WgXcQ" }),
    )
  })

  it("markPublishClicked: progress=publish_clicked + publishClickedAt", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.markPublishClicked()
    const state = lastWrittenState()
    expect(state.progress).toBe("publish_clicked")
    expect(typeof state.publishClickedAt).toBe("string")
    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "info",
      "STATE_PROGRESS publish_clicked",
      expect.objectContaining({ event: "STATE_PROGRESS", progress: "publish_clicked" }),
    )
  })

  it("acknowledgeDuplicateRisk: duplicateRiskAcknowledged=true + DUPLICATE_RISK_ACK", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.acknowledgeDuplicateRisk()
    expect(lastWrittenState().duplicateRiskAcknowledged).toBe(true)
    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "warn",
      expect.stringContaining("DUPLICATE_RISK_ACK"),
      expect.objectContaining({ event: "DUPLICATE_RISK_ACK" }),
    )
  })

  it("setUploadMeta: uploadTitleFingerprint + uploadedFileName + UPLOAD_META", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.setUploadMeta("abc123fingerprint", "video-28.mp4")
    const state = lastWrittenState()
    expect(state.uploadTitleFingerprint).toBe("abc123fingerprint")
    expect(state.uploadedFileName).toBe("video-28.mp4")
    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "info",
      "UPLOAD_META",
      expect.objectContaining({
        event: "UPLOAD_META",
        uploadTitleFingerprint: "abc123fingerprint",
        uploadedFileName: "video-28.mp4",
      }),
    )
  })

  it("cleanup — log-only: НЕ пишет stateData (не клобберит currentPhase)", async () => {
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await fsm.enterPhase("cleanup")
    await fsm.exitPhase("cleanup")
    expect(updateMock).not.toHaveBeenCalled()
    expect(appendJobLogMock).toHaveBeenCalledWith(
      "job-1",
      "info",
      "STATE_ENTER cleanup",
      expect.objectContaining({ housekeeping: true }),
    )
  })

  it("best-effort: ошибка БД НЕ пробрасывается наружу", async () => {
    findUniqueMock.mockRejectedValue(new Error("db down"))
    const fsm = createPhaseObserver({ jobId: "job-1", buildMarker: "bm" })
    await expect(fsm.enterPhase("session_start")).resolves.toBeUndefined()
  })
})

describe("mapPostingPhaseToFsmPhase", () => {
  it("маппит poster-фазы в канонические FSM-фазы", () => {
    expect(mapPostingPhaseToFsmPhase("session_start")).toBe("session_start")
    expect(mapPostingPhaseToFsmPhase("cdp_connect")).toBe("connect_browser")
    expect(mapPostingPhaseToFsmPhase("login_check")).toBe("login_check")
    expect(mapPostingPhaseToFsmPhase("navigate_upload")).toBe("navigate_upload")
    expect(mapPostingPhaseToFsmPhase("file_upload")).toBe("file_upload")
    expect(mapPostingPhaseToFsmPhase("details")).toBe("fill_details")
    expect(mapPostingPhaseToFsmPhase("altered_content")).toBe("fill_details")
    expect(mapPostingPhaseToFsmPhase("made_for_kids")).toBe("set_audience")
    expect(mapPostingPhaseToFsmPhase("visibility")).toBe("set_visibility")
    expect(mapPostingPhaseToFsmPhase("submit")).toBe("publish")
    expect(mapPostingPhaseToFsmPhase("extract_url")).toBe("verify_published")
  })
})
