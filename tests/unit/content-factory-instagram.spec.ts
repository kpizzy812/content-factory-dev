import { describe, expect, it, vi } from "vitest"

import {
  createInstagramApiClient,
  type InstagramApiClient,
} from "../../server/utils/social/instagram-api"
import { createInstagramAdapter } from "../../server/utils/social/instagram"
import type { DecryptedAccount, UploadProgress } from "../../server/utils/social/types"

function account(): DecryptedAccount {
  return {
    id: 7,
    platform: "instagram",
    displayName: "Creator",
    platformUserId: "17841400000000000",
    accessToken: "token",
    refreshToken: null,
    expiresAt: new Date(Date.now() + 86_400_000),
  }
}

describe("official Instagram publishing", () => {
  it("creates a Trial Reel, waits for processing and publishes it", async () => {
    const progress: UploadProgress[] = []
    const client: InstagramApiClient = {
      getPublishingLimit: vi.fn().mockResolvedValue({ quotaUsage: 2, quotaTotal: 50 }),
      createReelContainer: vi.fn().mockResolvedValue("container-1"),
      getContainerStatus: vi.fn()
        .mockResolvedValueOnce({ statusCode: "IN_PROGRESS", status: "Processing" })
        .mockResolvedValueOnce({ statusCode: "FINISHED", status: "Finished" }),
      publishContainer: vi.fn().mockResolvedValue("media-1"),
      getMedia: vi.fn().mockResolvedValue({
        id: "media-1",
        permalink: "https://www.instagram.com/reel/example/",
        likeCount: 0,
        commentsCount: 0,
      }),
      getMediaInsights: vi.fn().mockResolvedValue({}),
    }
    const adapter = createInstagramAdapter({
      clientFactory: () => client,
      getAccessToken: async () => "token",
      resolveMediaUrl: async () => "https://cdn.example/video.mp4",
      sleep: async () => {},
      pollIntervalMs: 1,
    })

    const result = await adapter.uploadVideo(account(), {
      filePath: "/tmp/video.mp4",
      title: "Title",
      description: "Description",
      hashtags: ["factory"],
      isShort: true,
      platformOptions: {
        instagram: { publishMode: "trial_auto" },
      },
      onProgress: async value => progress.push(value),
    })

    expect(client.createReelContainer).toHaveBeenCalledWith({
      userId: "17841400000000000",
      videoUrl: "https://cdn.example/video.mp4",
      caption: "Title\nDescription\n#factory",
      shareToFeed: false,
      trialStrategy: "SS_PERFORMANCE",
    })
    expect(client.publishContainer).toHaveBeenCalledWith(
      "17841400000000000",
      "container-1",
    )
    expect(progress).toEqual([
      { containerId: "container-1" },
      { postId: "media-1" },
      {
        postId: "media-1",
        postUrl: "https://www.instagram.com/reel/example/",
      },
    ])
    expect(result).toEqual({
      platformPostId: "media-1",
      platformPostUrl: "https://www.instagram.com/reel/example/",
    })
  })

  it("resumes a published upload instead of creating a duplicate post", async () => {
    const client: InstagramApiClient = {
      getPublishingLimit: vi.fn(),
      createReelContainer: vi.fn(),
      getContainerStatus: vi.fn(),
      publishContainer: vi.fn(),
      getMedia: vi.fn().mockResolvedValue({
        id: "media-existing",
        permalink: "https://www.instagram.com/reel/existing/",
        likeCount: 0,
        commentsCount: 0,
      }),
      getMediaInsights: vi.fn().mockResolvedValue({}),
    }
    const adapter = createInstagramAdapter({
      clientFactory: () => client,
      getAccessToken: async () => "token",
      resolveMediaUrl: async () => {
        throw new Error("must not resolve media for a completed retry")
      },
    })

    const result = await adapter.uploadVideo(account(), {
      filePath: "/tmp/video.mp4",
      title: "Title",
      description: "",
      hashtags: [],
      isShort: true,
      resume: { postId: "media-existing" },
    })

    expect(client.createReelContainer).not.toHaveBeenCalled()
    expect(client.publishContainer).not.toHaveBeenCalled()
    expect(result.platformPostId).toBe("media-existing")
  })

  it("blocks publishing when the live account quota is exhausted", async () => {
    const client: InstagramApiClient = {
      getPublishingLimit: vi.fn().mockResolvedValue({ quotaUsage: 50, quotaTotal: 50 }),
      createReelContainer: vi.fn(),
      getContainerStatus: vi.fn(),
      publishContainer: vi.fn(),
      getMedia: vi.fn(),
      getMediaInsights: vi.fn(),
    }
    const adapter = createInstagramAdapter({
      clientFactory: () => client,
      getAccessToken: async () => "token",
      resolveMediaUrl: async () => "https://cdn.example/video.mp4",
    })

    await expect(adapter.uploadVideo(account(), {
      filePath: "/tmp/video.mp4",
      title: "Title",
      description: "",
      hashtags: [],
      isShort: true,
    })).rejects.toThrow("Instagram publishing quota exhausted")

    expect(client.createReelContainer).not.toHaveBeenCalled()
  })

  it("uses bearer auth and never puts the access token in the URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "container-1" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ))
    const client = createInstagramApiClient({
      accessToken: "top-secret-token",
      fetchImpl,
      apiVersion: "v25.0",
    })

    await client.createReelContainer({
      userId: "ig-user",
      videoUrl: "https://cdn.example/video.mp4",
      caption: "Caption",
      shareToFeed: true,
    })

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).not.toContain("top-secret-token")
    expect(init.headers.Authorization).toBe("Bearer top-secret-token")
  })
})
