import { describe, expect, it, vi } from "vitest"
import { readReplicateConfig } from "../../../server/utils/replicate/config"
import { createReplicateProvider } from "../../../server/utils/replicate/client"
import {
  classifyReplicateError,
  sanitizeReplicateErrorMessage,
} from "../../../server/utils/replicate/errors"
import { resolveMediaModel } from "../../../server/utils/media-provider/registry"

function prediction(overrides: Record<string, unknown> = {}) {
  return {
    id: "external_1",
    status: "starting",
    model: "kwaivgi/kling-lip-sync",
    version: "hidden",
    input: {},
    source: "api",
    data_removed: false,
    created_at: "2026-07-22T06:00:00.000Z",
    urls: { get: "https://api.replicate.com/v1/predictions/external_1", cancel: "https://api.replicate.com/v1/predictions/external_1/cancel" },
    ...overrides,
  }
}

describe("Replicate provider client", () => {
  it("creates an asynchronous model prediction with completed-only webhook", async () => {
    const create = vi.fn(async () => prediction())
    const client = {
      predictions: {
        create,
        get: vi.fn(),
        cancel: vi.fn(),
      },
    }
    const config = readReplicateConfig({
      REPLICATE_API_TOKEN: "test-token",
      REPLICATE_WEBHOOK_SIGNING_SECRET: "test-secret",
      REPLICATE_WEBHOOK_BASE_URL: "https://factory.example.com",
    })
    const provider = createReplicateProvider({ config, client })
    const model = resolveMediaModel("lip_sync")

    const result = await provider.create({
      model,
      input: { video_url: "https://cdn.example.com/video.mp4", audio_file: "https://cdn.example.com/audio.mp3" },
      webhookUrl: config.webhookUrl,
      idempotencyKey: "video:1:scene:1",
    })

    expect(result).toMatchObject({
      externalId: "external_1",
      provider: "replicate",
      status: "starting",
      outputUrl: null,
    })
    expect(create).toHaveBeenCalledWith({
      model: "kwaivgi/kling-lip-sync",
      input: { video_url: "https://cdn.example.com/video.mp4", audio_file: "https://cdn.example.com/audio.mp3" },
      webhook: "https://factory.example.com/api/webhooks/replicate",
      webhook_events_filter: ["completed"],
    })
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("wait")
  })

  it("normalizes get and cancel responses", async () => {
    const get = vi.fn(async () => prediction({
      status: "succeeded",
      output: "https://replicate.delivery/output.mp4",
      started_at: "2026-07-22T06:00:01.000Z",
      completed_at: "2026-07-22T06:00:06.000Z",
    }))
    const cancel = vi.fn(async () => prediction({ status: "canceled" }))
    const config = readReplicateConfig({ REPLICATE_MOCK_MODE: "true" })
    const provider = createReplicateProvider({
      config,
      client: { predictions: { create: vi.fn(), get, cancel } },
    })

    await expect(provider.get("external_1")).resolves.toMatchObject({
      status: "succeeded",
      outputUrl: "https://replicate.delivery/output.mp4",
      startedAt: new Date("2026-07-22T06:00:01.000Z"),
    })
    await expect(provider.cancel("external_1")).resolves.toMatchObject({ status: "canceled" })
  })

  it("classifies retryable HTTP errors and redacts the API token", () => {
    const rateLimit = Object.assign(new Error("rate limited"), { status: 429 })
    const invalidInput = Object.assign(new Error("bad input"), { status: 422 })

    expect(classifyReplicateError(rateLimit)).toMatchObject({ retryable: true, status: 429 })
    expect(classifyReplicateError(invalidInput)).toMatchObject({ retryable: false, status: 422 })
    expect(sanitizeReplicateErrorMessage("request failed for test-token", "test-token"))
      .toBe("request failed for [REDACTED]")
  })
})
