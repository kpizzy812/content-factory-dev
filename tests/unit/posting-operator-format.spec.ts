/**
 * Unit-тесты operator-форматтера ошибок FSM (PR5A).
 *
 * Гарантии: каждый класс маппится, operatorAction непустой, тексты ключевых
 * классов несут правильный смысл (indigo=wait/stabilize без cookies/selector;
 * auth=refresh cookies/login; duplicate=no blind re-upload), а retryable
 * согласован с CLASS_RETRY_POLICY.disposition.
 */
import { describe, expect, it } from "vitest"
import {
  OPERATOR_ERROR_CLASSES,
  formatPostingFailureForOperator,
  toOperatorErrorClass,
  type OperatorErrorClass,
} from "../../shared/utils/posting-operator-format"
import { YOUTUBE_POSTING_ERROR_CLASSES } from "../../shared/types/youtube-posting-fsm"
import { CLASS_RETRY_POLICY } from "../../server/utils/posting/phase-policy"

describe("formatPostingFailureForOperator — полнота", () => {
  it("маппит каждый OperatorErrorClass без пустых полей", () => {
    expect(OPERATOR_ERROR_CLASSES).toHaveLength(13)
    for (const cls of OPERATOR_ERROR_CLASSES) {
      const v = formatPostingFailureForOperator(cls)
      expect(v.title, cls).toBeTruthy()
      expect(v.shortMessage, cls).toBeTruthy()
      expect(v.technicalDetails, cls).toBeTruthy()
      expect(v.operatorAction, cls).toBeTruthy()
      expect(["info", "warning", "error", "critical"]).toContain(v.severity)
      expect(typeof v.retryable).toBe("boolean")
      expect(typeof v.requiresHuman).toBe("boolean")
    }
  })

  it("нет ни одного класса без operatorAction", () => {
    const missing = OPERATOR_ERROR_CLASSES.filter(
      (c) => formatPostingFailureForOperator(c).operatorAction.trim().length === 0,
    )
    expect(missing).toEqual([])
  })

  it("retryable согласован с CLASS_RETRY_POLICY (retryable === disposition !== terminal)", () => {
    for (const cls of YOUTUBE_POSTING_ERROR_CLASSES) {
      const expected = CLASS_RETRY_POLICY[cls].disposition !== "terminal"
      expect(formatPostingFailureForOperator(cls).retryable, cls).toBe(expected)
    }
  })

  it("неизвестная строка → unknown", () => {
    expect(toOperatorErrorClass("чтото_левое")).toBe("unknown")
    expect(toOperatorErrorClass(null)).toBe("unknown")
    expect(formatPostingFailureForOperator("garbage" as OperatorErrorClass).title).toBe(
      formatPostingFailureForOperator("unknown").title,
    )
  })
})

describe("formatPostingFailureForOperator — смысл текстов", () => {
  it("indigo_unstable: ждать/стабилизировать Indigo, БЕЗ cookies/selector", () => {
    const v = formatPostingFailureForOperator("indigo_unstable")
    expect(v.operatorAction.toLowerCase()).toMatch(/indigo/)
    expect(v.operatorAction.toLowerCase()).toMatch(/окно|стабильн|retry/)
    // Не должно сбивать оператора на чужой класс проблем.
    expect(v.operatorAction.toLowerCase()).not.toMatch(/cookie|selector|селектор/)
    expect(v.shortMessage.toLowerCase()).not.toMatch(/cookie|selector|селектор/)
    expect(v.retryable).toBe(true)
    expect(v.requiresHuman).toBe(false)
  })

  it("auth_required: обновить cookies / проверить login", () => {
    const v = formatPostingFailureForOperator("auth_required")
    expect(v.operatorAction.toLowerCase()).toMatch(/cookie/)
    expect(v.operatorAction.toLowerCase()).toMatch(/login|вход|войт/)
    expect(v.retryable).toBe(false)
    expect(v.requiresHuman).toBe(true)
  })

  it("login_required: свежий login + cookie snapshot", () => {
    const v = formatPostingFailureForOperator("login_required")
    expect(v.operatorAction.toLowerCase()).toMatch(/login|вход/)
    expect(v.operatorAction.toLowerCase()).toMatch(/cookie|snapshot/)
    expect(v.requiresHuman).toBe(true)
  })

  it("duplicate_risk: слепой re-upload запрещён, проверить вручную", () => {
    const v = formatPostingFailureForOperator("duplicate_risk")
    expect(v.shortMessage.toLowerCase()).toMatch(/upload|загрузк/)
    expect((v.shortMessage + v.operatorAction).toLowerCase()).toMatch(/запрещ|не дела|вручную/)
    expect(v.severity).toBe("critical")
    expect(v.requiresHuman).toBe(true)
  })

  it("requires_human: ручное вмешательство, critical", () => {
    const v = formatPostingFailureForOperator("requires_human")
    expect(v.severity).toBe("critical")
    expect(v.requiresHuman).toBe(true)
    expect(v.retryable).toBe(false)
  })

  it("proxy_dead: не публиковать (риск бана), critical", () => {
    const v = formatPostingFailureForOperator("proxy_dead")
    expect(v.severity).toBe("critical")
    expect(v.operatorAction.toLowerCase()).toMatch(/прокси|proxy/)
    expect(v.operatorAction.toLowerCase()).toMatch(/не публ|бан/)
  })

  it("network_error: transient warning, авто-retry", () => {
    const v = formatPostingFailureForOperator("network_error")
    expect(v.severity).toBe("warning")
    expect(v.retryable).toBe(true)
    expect(v.requiresHuman).toBe(false)
  })
})

describe("formatPostingFailureForOperator — обогащение technicalDetails", () => {
  it("включает phase/progress/draftVideoId/finalReason из контекста", () => {
    const v = formatPostingFailureForOperator(
      "browser_lost",
      "file_upload",
      "file_attached_unconfirmed",
      "browser_lost",
      { draftVideoId: "abc123", lastCompletedPhase: "open_upload_dialog" },
    )
    expect(v.technicalDetails).toMatch(/file_upload/)
    expect(v.technicalDetails).toMatch(/file_attached_unconfirmed/)
    expect(v.technicalDetails).toMatch(/abc123/)
    expect(v.technicalDetails).toMatch(/open_upload_dialog/)
  })

  it("severity/retryable/requiresHuman НЕ зависят от контекста (только от класса)", () => {
    const a = formatPostingFailureForOperator("indigo_unstable")
    const b = formatPostingFailureForOperator("indigo_unstable", "session_start", "file_not_attached", "indigo_unstable")
    expect(b.severity).toBe(a.severity)
    expect(b.retryable).toBe(a.retryable)
    expect(b.requiresHuman).toBe(a.requiresHuman)
  })
})
