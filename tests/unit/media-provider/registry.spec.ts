import { describe, expect, it } from "vitest"
import {
  estimateMediaCost,
  mapMediaInput,
  resolveMediaModel,
} from "../../../server/utils/media-provider/registry"

describe("media model registry", () => {
  it("uses Replicate Kling as the default lip-sync model", () => {
    const model = resolveMediaModel("lip_sync")

    expect(model.id).toBe("kwaivgi/kling-lip-sync")
    expect(model.provider).toBe("replicate")
    expect(model.capability).toBe("lip_sync")
  })

  it("maps normalized lip-sync input to Replicate fields", () => {
    const model = resolveMediaModel("lip_sync")

    expect(mapMediaInput(model, {
      videoUrl: "https://cdn.example.com/presenter.mp4",
      audioUrl: "https://cdn.example.com/speech.mp3",
    })).toEqual({
      video_url: "https://cdn.example.com/presenter.mp4",
      audio_file: "https://cdn.example.com/speech.mp3",
    })
  })

  it("estimates Kling lip-sync cost per output second", () => {
    const model = resolveMediaModel("lip_sync")

    expect(estimateMediaCost(model, 70)).toBeCloseTo(0.98, 8)
  })

  it("publishes the input restrictions used for source validation", () => {
    const model = resolveMediaModel("lip_sync")

    expect(model.constraints).toMatchObject({
      videoExtensions: ["mp4", "mov"],
      audioExtensions: ["mp3", "wav", "m4a", "aac"],
      minDurationSec: 2,
      maxDurationSec: 10,
      maxVideoBytes: 100 * 1024 * 1024,
      maxAudioBytes: 5 * 1024 * 1024,
    })
  })

  it("rejects unsupported capabilities and model ids", () => {
    expect(() => resolveMediaModel("avatar_generation" as "lip_sync"))
      .toThrow("Unsupported media capability")
    expect(() => resolveMediaModel("lip_sync", "unknown/model"))
      .toThrow("Unsupported media model")
  })
})
