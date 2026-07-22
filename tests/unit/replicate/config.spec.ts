import { describe, expect, it } from "vitest"
import { readReplicateConfig } from "../../../server/utils/replicate/config"

describe("readReplicateConfig", () => {
  it("requires an API token outside mock mode", () => {
    expect(() => readReplicateConfig({
      REPLICATE_MOCK_MODE: "false",
      REPLICATE_WEBHOOK_BASE_URL: "https://factory.example.com",
    })).toThrow("REPLICATE_API_TOKEN")
  })

  it("uses Kling lip sync as the default model", () => {
    const config = readReplicateConfig({
      REPLICATE_MOCK_MODE: "true",
    })

    expect(config.defaultLipSyncModel).toBe("kwaivgi/kling-lip-sync")
  })

  it("requires a webhook base URL when webhooks are enabled", () => {
    expect(() => readReplicateConfig({
      REPLICATE_API_TOKEN: "test-token",
      REPLICATE_MOCK_MODE: "false",
    })).toThrow("REPLICATE_WEBHOOK_BASE_URL")
  })

  it("normalizes the webhook URL without a trailing slash", () => {
    const config = readReplicateConfig({
      REPLICATE_API_TOKEN: "test-token",
      REPLICATE_WEBHOOK_BASE_URL: "https://factory.example.com/",
      REPLICATE_WEBHOOK_SIGNING_SECRET: "test-signing-secret",
    })

    expect(config.webhookUrl).toBe("https://factory.example.com/api/webhooks/replicate")
  })
})
