import { describe, expect, it, vi } from "vitest"
import { readReplicateConfig } from "../../server/utils/replicate/config"
import {
  MediaProviderRetriesExhaustedError,
  runLipSync,
} from "../../server/utils/media-provider/lip-sync"

const baseInput = {
  videoId: 42,
  videoAssetId: 108,
  sceneOrder: 3,
  sourceVideoPath: "C:/media/source.mp4",
  audioPath: "C:/media/speech.mp3",
  outputPath: "C:/media/lipsynced.mp4",
  durationSec: 5,
}

describe("provider-neutral lip-sync", () => {
  it("uses Replicate Kling by default with deterministic identity and current pricing", async () => {
    const executeReplicatePrediction = vi.fn(async () => ({
      predictionId: "prediction_1",
      persistedStorageKey: "zavodcamp/media-predictions/prediction_1/output.mp4",
    }))
    const materializeOutput = vi.fn(async () => {})
    const uploadReplicateInput = vi.fn(async (path: string) => ({
      id: path.endsWith(".mp4") ? "file_video" : "file_audio",
      url: path.endsWith(".mp4")
        ? "https://api.replicate.com/v1/files/video"
        : "https://api.replicate.com/v1/files/audio",
    }))

    const result = await runLipSync(baseInput, {
      config: readReplicateConfig({ REPLICATE_MOCK_MODE: "true" }),
      fingerprintFile: async path => path.endsWith(".mp4") ? "source-sha" : "audio-sha",
      uploadReplicateInput,
      deleteReplicateInput: vi.fn(async () => {}),
      executeReplicatePrediction,
      materializeOutput,
    })

    expect(executeReplicatePrediction).toHaveBeenCalledWith(expect.objectContaining({
      videoId: 42,
      videoAssetId: 108,
      model: expect.objectContaining({
        id: "kwaivgi/kling-lip-sync",
        provider: "replicate",
      }),
      input: {
        video_url: "https://api.replicate.com/v1/files/video",
        audio_file: "https://api.replicate.com/v1/files/audio",
      },
      webhookUrl: null,
      idempotencyKey: "lip-sync:v1:video:42:scene:3:source:source-sha:audio:audio-sha:model:kwaivgi/kling-lip-sync",
    }))
    expect(uploadReplicateInput).toHaveBeenNthCalledWith(1, baseInput.sourceVideoPath, "video/mp4")
    expect(uploadReplicateInput).toHaveBeenNthCalledWith(2, baseInput.audioPath, "audio/mpeg")
    expect(materializeOutput).toHaveBeenCalledWith(
      "zavodcamp/media-predictions/prediction_1/output.mp4",
      baseInput.outputPath,
    )
    expect(result).toEqual(expect.objectContaining({
      localPath: baseInput.outputPath,
      provider: "replicate",
      modelId: "kwaivgi/kling-lip-sync",
      predictionId: "prediction_1",
      costUsd: 0.07,
    }))
  })

  it("calls fal only when explicitly enabled after Replicate retries are exhausted", async () => {
    const exhausted = new MediaProviderRetriesExhaustedError(
      "replicate",
      2,
      new Error("rate limited"),
    )
    const executeReplicatePrediction = vi.fn(async () => { throw exhausted })
    const runFal = vi.fn(async () => ({
      localPath: baseInput.outputPath,
      provider: "fal" as const,
      modelId: "fal-ai/sync-lipsync",
      predictionId: null,
      costUsd: 0.335,
    }))
    const shared = {
      fingerprintFile: async () => "sha",
      uploadReplicateInput: async () => ({ id: "file", url: "https://files.example/input" }),
      deleteReplicateInput: async () => {},
      executeReplicatePrediction,
      materializeOutput: async () => {},
      runFal,
    }

    await expect(runLipSync(baseInput, {
      ...shared,
      config: readReplicateConfig({ REPLICATE_MOCK_MODE: "true" }),
    })).rejects.toBe(exhausted)
    expect(runFal).not.toHaveBeenCalled()

    await expect(runLipSync(baseInput, {
      ...shared,
      config: readReplicateConfig({
        REPLICATE_MOCK_MODE: "true",
        MEDIA_PROVIDER_FALLBACK: "fal",
      }),
    })).resolves.toEqual(expect.objectContaining({ provider: "fal" }))
    expect(runFal).toHaveBeenCalledTimes(1)
  })
})
