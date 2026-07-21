/**
 * Unit-тесты резолвера режима FSM (PR5B + PR1): precedence + platform-gate +
 * rollback. Чистая функция (читает process.env) — env-переменные ставим/чистим
 * герметично. PR1: FSM-able {youtube, instagram}; матрица env × platform
 * доказывает (а) YouTube-резолв НЕ изменился, (б) IG дефолт OFF, (в) IG включается
 * через INSTAGRAM_POSTING_FSM_ENABLED=true.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  INSTAGRAM_FSM_CODE_DEFAULT,
  YOUTUBE_FSM_CODE_DEFAULT,
  resolvePostingFsmMode,
  resolveYoutubeFsmMode,
} from "../../server/utils/posting/fsm-config"

const ENABLED = "YOUTUBE_POSTING_FSM_ENABLED"
const DEFAULT = "YOUTUBE_POSTING_FSM_DEFAULT"
const IG_ENABLED = "INSTAGRAM_POSTING_FSM_ENABLED"
const IG_DEFAULT = "INSTAGRAM_POSTING_FSM_DEFAULT"

const ALL_ENV = [ENABLED, DEFAULT, IG_ENABLED, IG_DEFAULT] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ALL_ENV) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})
afterEach(() => {
  for (const key of ALL_ENV) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe("resolveYoutubeFsmMode — precedence (YouTube)", () => {
  it("PR5B flip: code default ON для YouTube", () => {
    expect(YOUTUBE_FSM_CODE_DEFAULT).toBe(true)
  })

  it("обе env не заданы → code_default (ON)", () => {
    const m = resolveYoutubeFsmMode("youtube")
    expect(m.enabled).toBe(true)
    expect(m.source).toBe("code_default")
    expect(m.envEnabled).toBeNull()
    expect(m.envDefault).toBeNull()
  })

  it("ENABLED=true → ON (env_enabled)", () => {
    process.env[ENABLED] = "true"
    const m = resolveYoutubeFsmMode("youtube")
    expect(m.enabled).toBe(true)
    expect(m.source).toBe("env_enabled")
  })

  it("ENABLED=false → OFF (env_enabled) — emergency rollback", () => {
    process.env[ENABLED] = "false"
    const m = resolveYoutubeFsmMode("youtube")
    expect(m.enabled).toBe(false)
    expect(m.source).toBe("env_enabled")
  })

  it("DEFAULT=true, ENABLED не задан → ON (env_default)", () => {
    process.env[DEFAULT] = "true"
    const m = resolveYoutubeFsmMode("youtube")
    expect(m.enabled).toBe(true)
    expect(m.source).toBe("env_default")
  })

  it("DEFAULT=false, ENABLED не задан → OFF (env_default)", () => {
    process.env[DEFAULT] = "false"
    const m = resolveYoutubeFsmMode("youtube")
    expect(m.enabled).toBe(false)
    expect(m.source).toBe("env_default")
  })

  it("ENABLED=false перекрывает DEFAULT=true (override > deploy default)", () => {
    process.env[ENABLED] = "false"
    process.env[DEFAULT] = "true"
    const m = resolveYoutubeFsmMode("youtube")
    expect(m.enabled).toBe(false)
    expect(m.source).toBe("env_enabled")
  })

  it("мусорное значение ENABLED игнорируется → падает в default", () => {
    process.env[ENABLED] = "yes"
    const m = resolveYoutubeFsmMode("youtube")
    expect(m.source).toBe("code_default")
    expect(m.enabled).toBe(true)
  })
})

describe("resolvePostingFsmMode — platform-gate (FSM-able {youtube, instagram})", () => {
  it("tiktok → OFF даже при YT ENABLED=true (non_fsm_platform)", () => {
    process.env[ENABLED] = "true"
    const m = resolvePostingFsmMode("tiktok")
    expect(m.enabled).toBe(false)
    expect(m.source).toBe("non_fsm_platform")
    expect(m.fsmAble).toBe(false)
  })

  it("неизвестная платформа → OFF (non_fsm_platform)", () => {
    const m = resolvePostingFsmMode("threads")
    expect(m.enabled).toBe(false)
    expect(m.source).toBe("non_fsm_platform")
    expect(m.fsmAble).toBe(false)
  })

  it("youtube → подчиняется precedence (ON по code default)", () => {
    const m = resolvePostingFsmMode("youtube")
    expect(m.enabled).toBe(true)
    expect(m.fsmAble).toBe(true)
  })

  it("platform не задан → глобальный YouTube-резолв (дефолтная платформа)", () => {
    const m = resolvePostingFsmMode()
    expect(m.enabled).toBe(true)
    expect(m.source).toBe("code_default")
    expect(m.fsmAble).toBe(true)
  })
})

describe("resolvePostingFsmMode — Instagram (PR1, дефолт OFF)", () => {
  it("PR1: IG code default = OFF", () => {
    expect(INSTAGRAM_FSM_CODE_DEFAULT).toBe(false)
  })

  it("обе IG env не заданы → code_default (OFF)", () => {
    const m = resolvePostingFsmMode("instagram")
    expect(m.enabled).toBe(false)
    expect(m.source).toBe("code_default")
    expect(m.fsmAble).toBe(true)
    expect(m.envEnabled).toBeNull()
    expect(m.envDefault).toBeNull()
  })

  it("INSTAGRAM_POSTING_FSM_ENABLED=true → ON (env_enabled)", () => {
    process.env[IG_ENABLED] = "true"
    const m = resolvePostingFsmMode("instagram")
    expect(m.enabled).toBe(true)
    expect(m.source).toBe("env_enabled")
  })

  it("INSTAGRAM_POSTING_FSM_DEFAULT=true, ENABLED не задан → ON (env_default)", () => {
    process.env[IG_DEFAULT] = "true"
    const m = resolvePostingFsmMode("instagram")
    expect(m.enabled).toBe(true)
    expect(m.source).toBe("env_default")
  })

  it("INSTAGRAM_POSTING_FSM_ENABLED=false перекрывает DEFAULT=true", () => {
    process.env[IG_ENABLED] = "false"
    process.env[IG_DEFAULT] = "true"
    const m = resolvePostingFsmMode("instagram")
    expect(m.enabled).toBe(false)
    expect(m.source).toBe("env_enabled")
  })

  it("IG не реагирует на YOUTUBE_* env (изоляция флагов)", () => {
    process.env[ENABLED] = "true"
    process.env[DEFAULT] = "true"
    const m = resolvePostingFsmMode("instagram")
    expect(m.enabled).toBe(false)
    expect(m.source).toBe("code_default")
  })
})

describe("YouTube-резолв НЕ изменён через resolveYoutubeFsmMode (обёртка) и resolvePostingFsmMode", () => {
  it("обёртка resolveYoutubeFsmMode = resolvePostingFsmMode для youtube", () => {
    process.env[ENABLED] = "false"
    const viaWrapper = resolveYoutubeFsmMode("youtube")
    const viaGeneric = resolvePostingFsmMode("youtube")
    expect(viaWrapper.enabled).toBe(viaGeneric.enabled)
    expect(viaWrapper.source).toBe(viaGeneric.source)
    expect(viaWrapper.enabled).toBe(false)
  })

  it("YT не реагирует на INSTAGRAM_* env (изоляция флагов)", () => {
    process.env[IG_ENABLED] = "true"
    const m = resolvePostingFsmMode("youtube")
    expect(m.enabled).toBe(true)
    expect(m.source).toBe("code_default")
  })
})
