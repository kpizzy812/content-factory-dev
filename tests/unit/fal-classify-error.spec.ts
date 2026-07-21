/**
 * Unit-тесты classifyFalError — гарантируют, что `detail` от fal.ai
 * пробрасывается в error message приоритетно (а не подменяется универсальным
 * "нет доступа к модели").
 *
 * Прецедент: 14.05.2026 баланс fal.ai исчерпан, fal вернул
 *   `{ detail: "User is locked. Reason: Exhausted balance..." }`
 * а наш код показывал маркетологу "нет доступа к модели" — 1.5 часа
 * диагностики не туда. См. .claude/agent-memory/architect/fal_403_research.md
 */
import { describe, expect, it } from "vitest"
import { classifyFalError } from "../../server/utils/fal"

const SUBMIT_URL = "https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video"

function makeOfetchError(status: number, detail: string | null): Error {
  const err = new Error(`[POST] "${SUBMIT_URL}": ${status} ${detail ?? ""}`) as Error & {
    response: { status: number; _data: unknown }
    data: { detail: string } | null
    statusCode: number
  }
  err.response = { status, _data: detail ? { detail } : null }
  err.data = detail ? { detail } : null
  err.statusCode = status
  return err
}

describe("classifyFalError", () => {
  it("403 'Exhausted balance' → сообщение о пополнении баланса", () => {
    const err = makeOfetchError(
      403,
      "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing.",
    )
    const msg = classifyFalError(err, SUBMIT_URL)
    expect(msg).toContain("Баланс fal.ai исчерпан")
    expect(msg).toContain("Top up your balance")
    expect(msg).not.toContain("Нет доступа к модели")
  })

  it("403 'Model not available' → сообщение о доступе к модели + сам detail", () => {
    const err = makeOfetchError(403, "Model not available for this workspace tier.")
    const msg = classifyFalError(err, SUBMIT_URL)
    expect(msg).toContain("Нет доступа к модели")
    expect(msg).toContain("fal-ai/kling-video/v3/standard/text-to-video")
    expect(msg).toContain("Model not available")
  })

  it("429 'Rate limit exceeded' → сообщение о rate limit", () => {
    const err = makeOfetchError(429, "Rate limit exceeded for this API key.")
    const msg = classifyFalError(err, SUBMIT_URL)
    expect(msg).toContain("rate limit")
    expect(msg).toContain("Rate limit exceeded")
  })

  it("422 с произвольным detail → generic с detail и endpoint", () => {
    const err = makeOfetchError(422, "duration must be one of 5, 10")
    const msg = classifyFalError(err, SUBMIT_URL)
    expect(msg).toContain("HTTP 422")
    expect(msg).toContain("duration must be one of")
    expect(msg).toContain("fal-ai/kling-video/v3/standard/text-to-video")
  })

  it("403 без detail → fallback на status-based message", () => {
    const err = makeOfetchError(403, null)
    const msg = classifyFalError(err, SUBMIT_URL)
    expect(msg).toContain("HTTP 403 Forbidden")
    expect(msg).toContain("Проверьте баланс")
    expect(msg).toContain("fal-ai/kling-video/v3/standard/text-to-video")
  })

  it("401 без detail → fallback про невалидный API key", () => {
    const err = makeOfetchError(401, null)
    const msg = classifyFalError(err, SUBMIT_URL)
    expect(msg).toContain("HTTP 401 Unauthorized")
    expect(msg).toContain("FAL_KEY")
  })

  it("неизвестный объект без status → generic fallback", () => {
    const msg = classifyFalError({ weird: "shape" }, SUBMIT_URL)
    expect(msg).toContain("HTTP unknown")
  })

  it("detail приоритетнее status — даже на 403 с balance вариант не подменяет на 'нет доступа'", () => {
    const err = makeOfetchError(403, "User is locked. Reason: Insufficient credit.")
    const msg = classifyFalError(err, SUBMIT_URL)
    expect(msg).toContain("Баланс fal.ai исчерпан")
    expect(msg).not.toMatch(/^Нет доступа/)
  })

  it("detail из error.body (альтернативный путь) — тоже подхватывается", () => {
    const err = new Error("fake") as Error & { body: { detail: string }; statusCode: number }
    err.body = { detail: "User is locked. Reason: Exhausted balance." }
    err.statusCode = 403
    const msg = classifyFalError(err, SUBMIT_URL)
    expect(msg).toContain("Баланс fal.ai исчерпан")
  })
})
