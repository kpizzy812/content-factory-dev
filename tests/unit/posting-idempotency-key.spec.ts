/**
 * Unit-тесты buildIdempotencyKey (PR5 / B2).
 *
 * Контракт:
 *  - runId задан (>0)  → ключ = sha256(videoId:socialAccountId:run:<runId>)
 *  - runId null/0/undefined → текущая схема sha256(videoId:socialAccountId:scheduledAt|asap)
 *    (backward-compatible, ручной/bulk путь не меняется).
 *
 * Pure-функция, БД не нужна.
 */
import { describe, expect, it } from "vitest"
import { buildIdempotencyKey } from "../../server/utils/posting/job-service"

describe("buildIdempotencyKey (PR5/B2)", () => {
  it("ручной asap-путь без runId = текущая схема (backward-compatible)", () => {
    const key = buildIdempotencyKey({ videoId: 1, socialAccountId: 2 })
    const keyAsapExplicit = buildIdempotencyKey({
      videoId: 1,
      socialAccountId: 2,
      scheduledAt: null,
      runId: null,
    })
    // оба = asap-схема, идентичны
    expect(key).toBe(keyAsapExplicit)
    expect(key).toMatch(/^[0-9a-f]{32}$/)
  })

  it("scheduledAt влияет на ключ в ручном пути", () => {
    const asap = buildIdempotencyKey({ videoId: 1, socialAccountId: 2 })
    const scheduled = buildIdempotencyKey({
      videoId: 1,
      socialAccountId: 2,
      scheduledAt: new Date("2026-06-03T10:00:00.000Z"),
    })
    expect(asap).not.toBe(scheduled)
  })

  it("pipeline-ключ (runId>0) ОТЛИЧАЕТСЯ от ручного asap-ключа того же video+account", () => {
    const manual = buildIdempotencyKey({ videoId: 5, socialAccountId: 7 })
    const pipeline = buildIdempotencyKey({
      videoId: 5,
      socialAccountId: 7,
      runId: 42,
    })
    expect(pipeline).not.toBe(manual)
    expect(pipeline).toMatch(/^[0-9a-f]{32}$/)
  })

  it("два РАЗНЫХ runId одного video+account НЕ схлопываются", () => {
    const run1 = buildIdempotencyKey({ videoId: 5, socialAccountId: 7, runId: 100 })
    const run2 = buildIdempotencyKey({ videoId: 5, socialAccountId: 7, runId: 101 })
    expect(run1).not.toBe(run2)
  })

  it("тот же runId+video+account → ОДИН ключ (идемпотентность внутри run)", () => {
    const a = buildIdempotencyKey({ videoId: 5, socialAccountId: 7, runId: 100 })
    const b = buildIdempotencyKey({ videoId: 5, socialAccountId: 7, runId: 100 })
    expect(a).toBe(b)
  })

  it("pipeline-ключ игнорирует scheduledAt (runId главенствует)", () => {
    const withSched = buildIdempotencyKey({
      videoId: 5,
      socialAccountId: 7,
      runId: 100,
      scheduledAt: new Date("2026-06-03T10:00:00.000Z"),
    })
    const noSched = buildIdempotencyKey({ videoId: 5, socialAccountId: 7, runId: 100 })
    expect(withSched).toBe(noSched)
  })

  it("runId<=0 трактуется как ручной путь (asap-схема)", () => {
    const zero = buildIdempotencyKey({ videoId: 5, socialAccountId: 7, runId: 0 })
    const manual = buildIdempotencyKey({ videoId: 5, socialAccountId: 7 })
    expect(zero).toBe(manual)
  })

  it("разные video/account дают разные ключи в pipeline-схеме", () => {
    const base = buildIdempotencyKey({ videoId: 5, socialAccountId: 7, runId: 100 })
    const diffVideo = buildIdempotencyKey({ videoId: 6, socialAccountId: 7, runId: 100 })
    const diffAccount = buildIdempotencyKey({ videoId: 5, socialAccountId: 8, runId: 100 })
    expect(base).not.toBe(diffVideo)
    expect(base).not.toBe(diffAccount)
  })
})
