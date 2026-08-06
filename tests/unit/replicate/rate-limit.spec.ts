import { describe, expect, it } from "vitest"
import { classifyReplicateError, ReplicateProviderError } from "../../../server/utils/replicate/errors"
import { withReplicateRetries } from "../../../server/utils/media-provider/lip-sync"

/** Как Replicate отвечает на превышение лимита создания predictions. */
function throttled(retryAfterSec: number): Error {
  return Object.assign(
    new Error(`Request to https://api.replicate.com/... failed with status 429 Too Many Requests: `
      + `{"detail":"Request was throttled.","status":429,"retry_after":${retryAfterSec}}`),
    { status: 429 },
  )
}

describe("Replicate rate limiting", () => {
  it("reads the pause Replicate asked for out of the error body", () => {
    const classified = classifyReplicateError(throttled(17))

    expect(classified.retryable).toBe(true)
    expect(classified.retryAfterSec).toBe(17)
  })

  it("ignores a missing or nonsensical retry_after", () => {
    expect(classifyReplicateError(new Error("boom")).retryAfterSec).toBeNull()
    expect(classifyReplicateError(throttled(0)).retryAfterSec).toBeNull()
  })

  it("waits at least as long as the provider asked before retrying", async () => {
    const slept: number[] = []
    let attempts = 0

    const result = await withReplicateRetries(
      async () => {
        attempts += 1
        if (attempts < 3) {
          throw new ReplicateProviderError("throttled", true, 429, undefined, 30)
        }
        return "done"
      },
      async (ms) => { slept.push(ms) },
    )

    expect(result).toBe("done")
    expect(attempts).toBe(3)
    // 30 секунд от провайдера перевешивают собственный бэкофф в 5 и 10 секунд.
    expect(slept).toEqual([31_000, 31_000])
  })

  it("keeps its own backoff when the provider named no pause", async () => {
    const slept: number[] = []
    let attempts = 0

    await withReplicateRetries(
      async () => {
        attempts += 1
        if (attempts < 2) throw new ReplicateProviderError("server error", true, 503)
        return "done"
      },
      async (ms) => { slept.push(ms) },
    )

    expect(slept).toEqual([5_000])
  })

  it("gives up on errors that retrying cannot fix", async () => {
    let attempts = 0

    await expect(withReplicateRetries(
      async () => {
        attempts += 1
        throw new ReplicateProviderError("insufficient credit", false, 402)
      },
      async () => {},
    )).rejects.toThrow("insufficient credit")
    expect(attempts).toBe(1)
  })
})
