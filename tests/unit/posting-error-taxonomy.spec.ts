/**
 * Unit-тесты чистого классификатора ошибок phase-level FSM (error-taxonomy.ts).
 *
 * Кейсы — ровно те условия terminal/retryable из принятой спецификации (§3) и
 * fingerprints из текущего кода. PR1: классификатор НЕ подключён к runtime.
 */
import { describe, expect, it } from "vitest"
import {
  classifyPostingError,
  mapErrorClassToPersisted,
} from "../../server/utils/posting/error-taxonomy"

describe("classifyPostingError — terminal vs retryable (§3)", () => {
  it("DevTools endpoint not ready → indigo_unstable, retryable", () => {
    const r = classifyPostingError({
      message: "Indigo не отдал рабочий CDP-порт: DevTools endpoint not ready (port=37239, 5 internal attempts)",
      phase: "session_start",
    })
    expect(r.errorClass).toBe("indigo_unstable")
    expect(r.retryable).toBe(true)
    expect(r.terminal).toBe(false)
    expect(r.persistedCategory).toBe("browser_connect_failed")
    expect(r.confident).toBe(true)
  })

  it("valid snapshot + store empty → browser_state_error, retryable", () => {
    const r = classifyPostingError({
      message: "Cloud cookies для youtube: store ПУСТОЙ несмотря на valid snapshot",
      phase: "login_check",
      hadValidSnapshot: true,
      storeHasCookies: false,
    })
    expect(r.errorClass).toBe("browser_state_error")
    expect(r.retryable).toBe(true)
    expect(r.persistedCategory).toBe("network_error")
  })

  it("snapshot missing (no_snapshot) → login_required, terminal", () => {
    const r = classifyPostingError({
      message: "Cloud cookies для youtube: snapshot отсутствует (restore reason: no_snapshot/no_snapshot)",
      phase: "login_check",
      restoreReason: "no_snapshot",
    })
    expect(r.errorClass).toBe("login_required")
    expect(r.terminal).toBe(true)
    expect(r.retryable).toBe(false)
    expect(r.persistedCategory).toBe("login_required")
  })

  it("all_expired → login_required, terminal", () => {
    const r = classifyPostingError({
      message: "snapshot полностью устарел",
      phase: "login_check",
      restoreReason: "all_expired",
    })
    expect(r.errorClass).toBe("login_required")
    expect(r.terminal).toBe(true)
  })

  it("store has cookies but no auth → login_required, terminal", () => {
    const r = classifyPostingError({
      message: "store содержит 12 cookies, но ни одного auth",
      phase: "login_check",
      storeHasCookies: true,
    })
    expect(r.errorClass).toBe("login_required")
    expect(r.terminal).toBe(true)
  })

  it("redirect на accounts.google.com → auth_required, terminal", () => {
    const r = classifyPostingError({
      message: "Сессия не залогинена: studio.youtube.com завернул на accounts.google.com",
      phase: "navigate_upload",
      redirectedHost: "accounts.google.com",
    })
    expect(r.errorClass).toBe("auth_required")
    expect(r.terminal).toBe(true)
    expect(r.persistedCategory).toBe("login_required")
  })

  it("detached Frame ДО attach (file_not_attached) → browser_lost, retryable", () => {
    const r = classifyPostingError({
      message: "Attempted to use detached Frame",
      phase: "navigate_upload",
      progress: "file_not_attached",
    })
    expect(r.errorClass).toBe("browser_lost")
    expect(r.retryable).toBe(true)
    expect(r.disposition).toBe("retryable")
  })

  it("detached Frame ПОСЛЕ attach (upload_started) → duplicate_risk, guarded (НЕ слепой retry)", () => {
    const r = classifyPostingError({
      message: "Target closed",
      phase: "upload_processing",
      progress: "upload_started",
    })
    expect(r.errorClass).toBe("duplicate_risk")
    expect(r.disposition).toBe("guarded")
    expect(r.retryable).toBe(false) // guarded, не плоский retry
    expect(r.terminal).toBe(false)
  })

  it("captcha → requires_human, terminal", () => {
    const r = classifyPostingError({ message: "Please solve the captcha to continue", phase: "navigate_upload" })
    expect(r.errorClass).toBe("requires_human")
    expect(r.terminal).toBe(true)
    expect(r.persistedCategory).toBe("account_locked")
  })

  it("verify it's you / phone challenge → requires_human, terminal", () => {
    expect(classifyPostingError({ message: "Verify it's you to continue" }).errorClass).toBe("requires_human")
    expect(classifyPostingError({ message: "Enter the phone verification code" }).errorClass).toBe("requires_human")
  })
})

describe("classifyPostingError — приоритет арбитража", () => {
  it("dead-port имеет приоритет над browser_lost (как worker.ts:535)", () => {
    const r = classifyPostingError({
      message: "DevTools endpoint not ready; detached Frame",
      phase: "session_start",
    })
    expect(r.errorClass).toBe("indigo_unstable")
  })

  it("network timeout → network_error, retryable", () => {
    const r = classifyPostingError({
      message: "Navigation timeout of 45000 ms exceeded (ERR_INSUFFICIENT_RESOURCES)",
      phase: "navigate_upload",
    })
    expect(r.errorClass).toBe("network_error")
    expect(r.retryable).toBe(true)
  })

  it("selector miss → selector_not_found (terminal), КРОМЕ open_upload_dialog", () => {
    const details = classifyPostingError({ message: "Не найден title input", phase: "fill_details" })
    expect(details.errorClass).toBe("selector_not_found")
    expect(details.terminal).toBe(true)

    // open_upload_dialog намеренно НЕ selector_not_found (youtube-poster кидает network_error для retry)
    const dialog = classifyPostingError({ message: "create button not found", phase: "open_upload_dialog" })
    expect(dialog.errorClass).not.toBe("selector_not_found")
  })

  it("неклассифицированное → fallback network_error, confident=false", () => {
    const r = classifyPostingError({ message: "что-то совсем неожиданное 0xDEADBEEF" })
    expect(r.errorClass).toBe("network_error")
    expect(r.confident).toBe(false)
  })
})

describe("mapErrorClassToPersisted — legacy enum mapping (без новой миграции)", () => {
  it("новые FSM-классы маппятся в существующие enum-значения", () => {
    expect(mapErrorClassToPersisted("browser_lost")).toBe("network_error")
    expect(mapErrorClassToPersisted("indigo_unstable")).toBe("browser_connect_failed")
    expect(mapErrorClassToPersisted("browser_state_error")).toBe("network_error")
    expect(mapErrorClassToPersisted("auth_required")).toBe("login_required")
    expect(mapErrorClassToPersisted("duplicate_risk")).toBe("network_error")
    expect(mapErrorClassToPersisted("requires_human")).toBe("account_locked")
  })

  it("уже существующие классы маппятся сами в себя", () => {
    expect(mapErrorClassToPersisted("network_error")).toBe("network_error")
    expect(mapErrorClassToPersisted("login_required")).toBe("login_required")
    expect(mapErrorClassToPersisted("selector_not_found")).toBe("selector_not_found")
    expect(mapErrorClassToPersisted("upload_failed")).toBe("upload_failed")
    expect(mapErrorClassToPersisted("browser_connect_failed")).toBe("browser_connect_failed")
  })
})
