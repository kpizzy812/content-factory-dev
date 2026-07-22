import { describe, expect, it } from "vitest"
import { resolveMediaModel } from "../../../server/utils/media-provider/registry"
import { createMockReplicateProvider } from "../../../server/utils/replicate/mock"

describe("mock Replicate provider", () => {
  it("uses a stable external id for the same idempotency key", async () => {
    const provider = createMockReplicateProvider()
    const request = {
      model: resolveMediaModel("lip_sync"),
      input: { video_url: "mock://video", audio_file: "mock://audio" },
      webhookUrl: null,
      idempotencyKey: "video:1:scene:1",
    }

    const first = await provider.create(request)
    const second = await provider.create(request)

    expect(first.externalId).toBe(second.externalId)
    expect(first.status).toBe("processing")
  })

  it("moves deterministically from processing to succeeded", async () => {
    const provider = createMockReplicateProvider({
      completeAfterPolls: 2,
      outputUrl: "mock://replicate/output.mp4",
    })
    const created = await provider.create({
      model: resolveMediaModel("lip_sync"),
      input: { video_url: "mock://video", audio_file: "mock://audio" },
      webhookUrl: null,
      idempotencyKey: "video:1:scene:2",
    })

    await expect(provider.get(created.externalId)).resolves.toMatchObject({ status: "processing" })
    await expect(provider.get(created.externalId)).resolves.toMatchObject({
      status: "succeeded",
      outputUrl: "mock://replicate/output.mp4",
    })
  })
})
