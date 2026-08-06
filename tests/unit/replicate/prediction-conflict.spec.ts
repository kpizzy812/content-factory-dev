import { describe, expect, it, vi } from "vitest"
import { createMediaPredictionRepository } from "../../../server/utils/replicate/prediction-repository"

/**
 * Состояние prediction меняют одновременно вебхук Replicate и поллинг пайплайна.
 * Postgres откатывает одну из Serializable-транзакций — это ожидаемый исход.
 */
function conflictError(): Error {
  return Object.assign(
    new Error("Transaction failed due to a write conflict or a deadlock. Please retry your transaction"),
    { code: "P2034" },
  )
}

function repositoryWith(transaction: (fn: unknown) => Promise<unknown>) {
  return createMediaPredictionRepository({
    mediaPrediction: {} as never,
    $transaction: transaction as never,
  } as never)
}

describe("media prediction write conflicts", () => {
  it("retries a rolled back transaction instead of failing the scene", async () => {
    const record = { id: "pred_1", status: "succeeded" }
    let calls = 0
    const repo = repositoryWith(async () => {
      calls += 1
      if (calls < 3) throw conflictError()
      return record
    })

    await expect(repo.applyStatusUpdate("ext_1", "succeeded")).resolves.toBe(record)
    expect(calls).toBe(3)
  })

  it("retries when our own compare-and-set lost the race", async () => {
    const record = { id: "pred_1", status: "succeeded" }
    let calls = 0
    const repo = repositoryWith(async () => {
      calls += 1
      if (calls === 1) throw new Error("Concurrent status update for media prediction pred_1")
      return record
    })

    await expect(repo.applyStatusUpdate("ext_1", "succeeded")).resolves.toBe(record)
    expect(calls).toBe(2)
  })

  it("does not mask errors that retrying cannot fix", async () => {
    const transaction = vi.fn(async () => { throw new Error("Media prediction not found for provider id: ext_9") })
    const repo = repositoryWith(transaction)

    await expect(repo.applyStatusUpdate("ext_9", "succeeded")).rejects.toThrow("not found")
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it("gives up after a bounded number of conflicts", async () => {
    const transaction = vi.fn(async () => { throw conflictError() })
    const repo = repositoryWith(transaction)

    await expect(repo.applyStatusUpdate("ext_1", "succeeded")).rejects.toThrow("write conflict")
    expect(transaction).toHaveBeenCalledTimes(5)
  })
})
