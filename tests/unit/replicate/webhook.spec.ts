import { describe, expect, it, vi } from "vitest"
import { createMediaPredictionRepository } from "../../../server/utils/replicate/prediction-repository"
import {
  handleReplicateWebhook,
  InvalidReplicateWebhookError,
} from "../../../server/utils/replicate/webhook"

const HEADERS = {
  "webhook-id": "msg_1",
  "webhook-timestamp": "1784700000",
  "webhook-signature": "v1,test-signature",
  "content-type": "application/json",
}

function payload(status: string) {
  return JSON.stringify({
    id: "external_1",
    status,
    model: "kwaivgi/kling-lip-sync",
    output: status === "succeeded" ? "https://replicate.delivery/output.mp4" : null,
    input: { authorization: "must-not-persist" },
    source: "api",
    data_removed: false,
    created_at: "2026-07-22T06:00:00.000Z",
    started_at: "2026-07-22T06:00:01.000Z",
    completed_at: status === "succeeded" ? "2026-07-22T06:00:06.000Z" : undefined,
    urls: { get: "https://api.replicate.com/v1/predictions/external_1" },
  })
}

describe("Replicate webhook", () => {
  it("rejects an invalid signature before parsing or persistence", async () => {
    const repository = { applyStatusUpdate: vi.fn() }

    await expect(handleReplicateWebhook({
      body: "not-even-json",
      headers: HEADERS,
      url: "https://factory.example.com/api/webhooks/replicate",
      secret: "test-secret",
      repository,
      validator: vi.fn(async () => false),
    })).rejects.toBeInstanceOf(InvalidReplicateWebhookError)
    expect(repository.applyStatusUpdate).not.toHaveBeenCalled()
  })

  it("applies a valid terminal payload once and ignores duplicate or late events", async () => {
    let row = {
      id: "internal_1",
      externalId: "external_1",
      idempotencyKey: "video:1:scene:1",
      status: "processing",
      inputSnapshot: {},
      outputSnapshot: null as unknown,
      outputUrl: null as string | null,
      errorMessage: null as string | null,
      terminalAt: null as Date | null,
      webhookReceivedAt: null as Date | null,
    }
    const updateMany = vi.fn(async (args: Record<string, any>) => {
      row = { ...row, ...args.data }
      return { count: 1 }
    })
    const client = {
      mediaPrediction: {
        findUnique: vi.fn(async () => row),
        updateMany,
      },
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(client),
    }
    const repository = createMediaPredictionRepository(client)
    const validator = vi.fn(async (request: Request, secret: string) => {
      expect(request).toBeInstanceOf(Request)
      expect(await request.text()).toContain("external_1")
      expect(secret).toBe("test-secret")
      return true
    })
    const base = {
      headers: HEADERS,
      url: "https://factory.example.com/api/webhooks/replicate",
      secret: "test-secret",
      repository,
      validator,
    }

    await handleReplicateWebhook({ ...base, body: payload("succeeded") })
    await handleReplicateWebhook({ ...base, body: payload("succeeded") })
    await handleReplicateWebhook({ ...base, body: payload("processing") })

    expect(row.status).toBe("succeeded")
    expect(row.outputUrl).toBe("https://replicate.delivery/output.mp4")
    expect(row.outputSnapshot).toMatchObject({
      input: { authorization: "[REDACTED]" },
    })
    expect(updateMany).toHaveBeenCalledTimes(1)
  })
})
