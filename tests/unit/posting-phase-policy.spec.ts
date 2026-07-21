/**
 * Unit-тесты декларативной policy phase-level FSM (phase-policy.ts).
 *
 * Проверяем completeness таблиц (каждая фаза/класс описаны, нет противоречий),
 * корректность backoff-расчёта (числом-в-число из worker.ts) и progress-guard.
 *
 * PR1: чистые данные/функции, без runtime.
 */
import { describe, expect, it } from "vitest"
import {
  YOUTUBE_POSTING_ERROR_CLASSES,
  YOUTUBE_POSTING_PHASE_ORDER,
  YOUTUBE_POSTING_PROGRESS_ORDER,
  type YouTubePostingErrorClass,
} from "../../shared/types/youtube-posting-fsm"
import {
  CLASS_RETRY_POLICY,
  PHASE_POLICIES,
  backoffForRetry,
  getClassRetryPolicy,
  getPhasePolicy,
  getProgressRetryPolicy,
  listPhasePolicies,
} from "../../server/utils/posting/phase-policy"

const MIN = 60 * 1000

describe("PHASE_POLICIES completeness", () => {
  it("PHASE_ORDER (runtime-источник) ровно 16 YouTube-фаз — IG-фазы НЕ в порядке исполнения YT", () => {
    expect(YOUTUBE_POSTING_PHASE_ORDER).toHaveLength(16)
    // PR1: PHASE_POLICIES — надмножество (16 YT + 7 ig_* placeholder для exhaustive
    // Record над расширенным union'ом). YOUTUBE_POSTING_PHASE_ORDER остаётся 16 —
    // listPhasePolicies/runtime итерирует только его → IG-фазы не влияют на YouTube.
    const keys = new Set(Object.keys(PHASE_POLICIES))
    // Все 16 YouTube-фаз присутствуют.
    for (const phase of YOUTUBE_POSTING_PHASE_ORDER) {
      expect(keys.has(phase), `нет policy для YouTube-фазы ${phase}`).toBe(true)
    }
    // 7 IG-фаз присутствуют как placeholder и НЕ входят в YT-порядок исполнения.
    const igPhases = [
      "ig_open_create",
      "ig_select_file",
      "ig_crop_next",
      "ig_edit_next",
      "ig_caption",
      "ig_share",
      "ig_verify",
    ] as const
    for (const ig of igPhases) {
      expect(keys.has(ig), `нет placeholder-policy для IG-фазы ${ig}`).toBe(true)
      expect(YOUTUBE_POSTING_PHASE_ORDER).not.toContain(ig)
    }
    expect(keys.size).toBe(16 + 7)
  })

  it("каждая фаза имеет policy с непустыми purpose/successCriteria/recovery", () => {
    for (const phase of YOUTUBE_POSTING_PHASE_ORDER) {
      const p = getPhasePolicy(phase)
      expect(p.phase).toBe(phase)
      expect(p.purpose.length).toBeGreaterThan(0)
      expect(p.successCriteria.length).toBeGreaterThan(0)
      expect(p.recoveryAction.length).toBeGreaterThan(0)
    }
  })

  it("listPhasePolicies возвращает фазы в порядке выполнения", () => {
    expect(listPhasePolicies().map((p) => p.phase)).toEqual([...YOUTUBE_POSTING_PHASE_ORDER])
  })

  it("на одной фазе класс не может быть одновременно retryable и terminal", () => {
    for (const phase of YOUTUBE_POSTING_PHASE_ORDER) {
      const p = getPhasePolicy(phase)
      const overlap = p.retryableClasses.filter((c) => p.terminalClasses.includes(c))
      expect(overlap, `фаза ${phase} имеет конфликт классов: ${overlap.join(",")}`).toEqual([])
    }
  })

  it("все классы, упомянутые в фазах, существуют в CLASS_RETRY_POLICY", () => {
    const valid = new Set<YouTubePostingErrorClass>(YOUTUBE_POSTING_ERROR_CLASSES)
    for (const phase of YOUTUBE_POSTING_PHASE_ORDER) {
      const p = getPhasePolicy(phase)
      for (const c of [...p.retryableClasses, ...p.terminalClasses]) {
        expect(valid.has(c), `фаза ${phase}: неизвестный класс ${c}`).toBe(true)
        expect(CLASS_RETRY_POLICY[c]).toBeDefined()
      }
    }
  })
})

describe("CLASS_RETRY_POLICY completeness", () => {
  it("описаны ровно 11 классов", () => {
    expect(YOUTUBE_POSTING_ERROR_CLASSES).toHaveLength(11)
    expect(Object.keys(CLASS_RETRY_POLICY).sort()).toEqual([...YOUTUBE_POSTING_ERROR_CLASSES].sort())
  })

  it("terminal классы: maxAttempts=0 и пустой backoff", () => {
    for (const c of YOUTUBE_POSTING_ERROR_CLASSES) {
      const pol = getClassRetryPolicy(c)
      if (pol.disposition === "terminal") {
        expect(pol.maxAttempts, c).toBe(0)
        expect(pol.backoffMs, c).toEqual([])
        expect(pol.windowMs, c).toBeNull()
      }
    }
  })

  it("retryable/guarded классы имеют непустой backoff", () => {
    for (const c of YOUTUBE_POSTING_ERROR_CLASSES) {
      const pol = getClassRetryPolicy(c)
      if (pol.disposition !== "terminal") {
        expect(pol.backoffMs.length, c).toBeGreaterThan(0)
      }
    }
  })

  it("оконные классы (indigo_unstable/browser_lost/duplicate_risk) — window=90м, корректный maxAttempts", () => {
    expect(getClassRetryPolicy("indigo_unstable").windowMs).toBe(90 * MIN)
    expect(getClassRetryPolicy("indigo_unstable").maxAttempts).toBe(7)
    expect(getClassRetryPolicy("browser_lost").windowMs).toBe(90 * MIN)
    expect(getClassRetryPolicy("browser_lost").maxAttempts).toBe(5)
    expect(getClassRetryPolicy("duplicate_risk").windowMs).toBe(90 * MIN)
  })

  it("generic-классы (network_error/browser_state_error/upload_failed) → maxAttempts=null (job.maxAttempts)", () => {
    expect(getClassRetryPolicy("network_error").maxAttempts).toBeNull()
    expect(getClassRetryPolicy("browser_state_error").maxAttempts).toBeNull()
    expect(getClassRetryPolicy("upload_failed").maxAttempts).toBeNull()
  })
})

describe("backoffForRetry (числом-в-число из worker.ts)", () => {
  it("indigo_unstable: 0→5м, 1→10м, 2→10м, ≥3→15м (clamp-to-last)", () => {
    expect(backoffForRetry("indigo_unstable", 0)).toBe(5 * MIN)
    expect(backoffForRetry("indigo_unstable", 1)).toBe(10 * MIN)
    expect(backoffForRetry("indigo_unstable", 2)).toBe(10 * MIN)
    expect(backoffForRetry("indigo_unstable", 3)).toBe(15 * MIN)
    expect(backoffForRetry("indigo_unstable", 99)).toBe(15 * MIN)
  })

  it("browser_lost: 0→5м, 1→7м, 2→7м, ≥3→10м (clamp-to-last)", () => {
    expect(backoffForRetry("browser_lost", 0)).toBe(5 * MIN)
    expect(backoffForRetry("browser_lost", 1)).toBe(7 * MIN)
    expect(backoffForRetry("browser_lost", 2)).toBe(7 * MIN)
    expect(backoffForRetry("browser_lost", 3)).toBe(10 * MIN)
  })

  it("generic network_error: 0→1м, 1→5м, 2→30м, 3→2ч, ≥4→12ч", () => {
    expect(backoffForRetry("network_error", 0)).toBe(1 * MIN)
    expect(backoffForRetry("network_error", 1)).toBe(5 * MIN)
    expect(backoffForRetry("network_error", 2)).toBe(30 * MIN)
    expect(backoffForRetry("network_error", 3)).toBe(2 * 60 * MIN)
    expect(backoffForRetry("network_error", 4)).toBe(12 * 60 * MIN)
    expect(backoffForRetry("network_error", 50)).toBe(12 * 60 * MIN)
  })

  it("terminal класс → backoff 0", () => {
    expect(backoffForRetry("login_required", 0)).toBe(0)
    expect(backoffForRetry("requires_human", 3)).toBe(0)
  })
})

describe("getProgressRetryPolicy (duplicate-upload guard)", () => {
  it("покрывает все 6 значений прогресса", () => {
    for (const p of YOUTUBE_POSTING_PROGRESS_ORDER) {
      expect(getProgressRetryPolicy(p)).toBeDefined()
    }
  })

  it("before attach → retry_safe (грузить заново безопасно)", () => {
    expect(getProgressRetryPolicy("file_not_attached")).toBe("retry_safe")
  })

  it("after attach → dedup_check (нужен dedup guard перед re-upload)", () => {
    expect(getProgressRetryPolicy("file_attached_unconfirmed")).toBe("dedup_check")
    expect(getProgressRetryPolicy("upload_started")).toBe("dedup_check")
    expect(getProgressRetryPolicy("processing_seen")).toBe("dedup_check")
    expect(getProgressRetryPolicy("details_seen")).toBe("dedup_check")
  })

  it("after publish_clicked → verify_no_republish (без слепого re-publish)", () => {
    expect(getProgressRetryPolicy("publish_clicked")).toBe("verify_no_republish")
    expect(getProgressRetryPolicy("publish_confirmed")).toBe("verify_no_republish")
  })
})
