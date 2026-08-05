import { describe, expect, it, vi } from "vitest"
import { runReplicateTts } from "../../../server/utils/media-provider/tts"
import type { ReplicateConfig } from "../../../server/utils/replicate/config"

const config: ReplicateConfig = {
  apiToken: "r8_test",
  webhookSigningSecret: "secret",
  webhookBaseUrl: "https://example.test",
  webhookUrl: "https://example.test/api/webhooks/replicate",
  defaultLipSyncModel: "kwaivgi/kling-lip-sync",
  defaultTtsModel: "minimax/speech-02-turbo",
  mockMode: true,
  recoveryEnabled: true,
  fallbackProvider: null,
}

function harness() {
  const submissions: Array<Record<string, unknown>> = []
  const executePrediction = vi.fn(async (submission: Record<string, unknown>) => {
    submissions.push(submission)
    return { predictionId: "pred_1", persistedStorageKey: "media/pred_1.mp3" }
  })
  const materializeOutput = vi.fn(async () => {})
  return { submissions, executePrediction, materializeOutput }
}

describe("Replicate TTS adapter", () => {
  it("submits Russian text with the MiniMax language switch", async () => {
    const { submissions, executePrediction, materializeOutput } = harness()

    const result = await runReplicateTts({
      text: "  Порция в сорок грамм — это двенадцать грамм сахара  ",
      outputPath: "/tmp/scene_7.mp3",
      language: "ru",
      videoId: 42,
    }, { config, executePrediction: executePrediction as never, materializeOutput })

    expect(submissions[0]).toMatchObject({
      videoId: 42,
      webhookUrl: config.webhookUrl,
      input: {
        text: "Порция в сорок грамм — это двенадцать грамм сахара",
        language_boost: "Russian",
      },
    })
    expect(result.provider).toBe("replicate")
    expect(result.audioPath).toBe("/tmp/scene_7.mp3")
    expect(result.characters).toBe("Порция в сорок грамм — это двенадцать грамм сахара".length)
    expect(materializeOutput).toHaveBeenCalledWith("media/pred_1.mp3", "/tmp/scene_7.mp3")
  })

  it("reuses one idempotency key for identical requests and changes it with the text", async () => {
    const { executePrediction, materializeOutput } = harness()
    const deps = { config, executePrediction: executePrediction as never, materializeOutput }
    const request = {
      text: "Замените на греческий йогурт без добавок",
      outputPath: "/tmp/a.mp3",
      language: "ru",
    }

    const first = await runReplicateTts(request, deps)
    const repeat = await runReplicateTts({ ...request, outputPath: "/tmp/b.mp3" }, deps)
    const other = await runReplicateTts({ ...request, text: "Другая реплика" }, deps)

    expect(repeat.idempotencyKey).toBe(first.idempotencyKey)
    expect(other.idempotencyKey).not.toBe(first.idempotencyKey)
  })

  it("clamps pacing to the provider's supported speed range", async () => {
    const { submissions, executePrediction, materializeOutput } = harness()
    const deps = { config, executePrediction: executePrediction as never, materializeOutput }

    await runReplicateTts({
      text: "Быстро", outputPath: "/tmp/fast.mp3", language: "ru", speed: 9,
    }, deps)
    await runReplicateTts({
      text: "Медленно", outputPath: "/tmp/slow.mp3", language: "ru", speed: 0.1,
    }, deps)

    expect((submissions[0]!.input as { speed: number }).speed).toBe(2)
    expect((submissions[1]!.input as { speed: number }).speed).toBe(0.5)
  })

  it("refuses empty text instead of paying for silence", async () => {
    const { executePrediction, materializeOutput } = harness()

    await expect(runReplicateTts({
      text: "   ",
      outputPath: "/tmp/empty.mp3",
      language: "ru",
    }, { config, executePrediction: executePrediction as never, materializeOutput }))
      .rejects.toThrow("empty text")
    expect(executePrediction).not.toHaveBeenCalled()
  })
})
