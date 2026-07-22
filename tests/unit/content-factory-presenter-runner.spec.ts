import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const readRepoFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("presenter source lip-sync contract", () => {
  it("rotates stored presenter clips through the provider-neutral lip-sync runner", () => {
    const selector = readRepoFile("server/utils/presenter-source-selector.ts")
    const runner = readRepoFile("server/utils/lip-sync-runner.ts")

    expect(selector).toContain("tx.presenterSourceClip")
    expect(selector).toContain("reservePresenterSourceClip")
    expect(runner).toContain("reservePresenterSourceClip")
    expect(runner).toContain("getStorageDriver")
    expect(runner).toContain("sourceVideoPath")
    expect(runner).toContain("videoConfig.lipSyncCharacterId")
  })

  it("passes the selected presenter through standalone and pipeline video creation", () => {
    const pipeline = readRepoFile("server/utils/video-pipeline.ts")
    const generateApi = readRepoFile("server/api/videos/generate.post.ts")
    const executor = readRepoFile("server/utils/pipeline-executors.ts")

    expect(pipeline).toContain("lipSyncCharacterId: video.lipSyncCharacterId")
    expect(generateApi).toContain("lipSyncCharacterId?: string | null")
    expect(generateApi).toContain("lipSyncCharacterId: resolvedLipSyncCharacterId")
    expect(executor).toContain("lipSyncCharacterId: resolvedLipSyncCharacterId")
  })
  it("synchronizes official upload results back to factory publications", () => {
    const uploadPipeline = readRepoFile("server/utils/upload-pipeline.ts")

    expect(uploadPipeline).toContain("syncFactoryPublicationFromUpload")
    expect(uploadPipeline).toContain("await syncFactoryPublicationFromUpload(uploadId)")
    expect(uploadPipeline).toContain('updateUploadStatus(uploadId, "failed"')
  })
  it("keeps video ids when captions pass output to official publishing", () => {
    const captionExecutor = readRepoFile("server/utils/pipeline-executors-extra.ts")

    expect(captionExecutor).toContain("id: Number(result.videoId")
  })
})