/**
 * Unit-тесты развилки executeUploadNode по postingMethod (PR5).
 *
 * Стратегия:
 *  - Реальная test-БД (App → Trend → Scenario(+variant) → Video(completed) +
 *    SocialAccount + Caption).
 *  - vi.mock на createPostingJob (job-service) и assertOneToOneForBrowserAutomation
 *    (one-to-one-guard) — чтобы перехватить аргументы развилки без реальной БД-вставки
 *    PostingJob/constraint'ов.
 *  - vi.mock на upload-pipeline.runUploadPipeline — чтобы api-путь не запускал реальную
 *    загрузку и можно было проверить, что он (НЕ)вызван.
 *
 * Покрытые сценарии:
 *   1. browser_automation IG-аккаунт → createPostingJob с runId/pipelineId и
 *      contentSnapshot.caption = ПОЛНЫЙ IG-текст (Caption.title), НЕ youtube title.
 *      runUploadPipeline НЕ вызван, Upload НЕ создан.
 *   2. api-аккаунт → старый путь: Upload создан, runUploadPipeline вызван,
 *      createPostingJob НЕ вызван (байт-в-байт).
 *   3. browser_automation + api в одной группе → каждый идёт своим треком, дублей нет.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { prisma } from "../../../server/utils/prisma"

// ── Module mocks ────────────────────────────────────────────────────────────
const { createPostingJobMock, assertOneToOneMock, runUploadPipelineMock } =
  vi.hoisted(() => ({
    createPostingJobMock: vi.fn(),
    assertOneToOneMock: vi.fn(),
    runUploadPipelineMock: vi.fn(),
  }))

vi.mock("../../../server/utils/posting/job-service", () => ({
  createPostingJob: createPostingJobMock,
}))
vi.mock("../../../server/utils/accounts/one-to-one-guard", () => ({
  assertOneToOneForBrowserAutomation: assertOneToOneMock,
}))
vi.mock("../../../server/utils/upload-pipeline", () => ({
  runUploadPipeline: runUploadPipelineMock,
}))

// runUploadPipeline / logAgent — bare-глобалы в pipeline-executors. В тестах нет
// Nuxt auto-import, поэтому подставляем заглушки.
vi.stubGlobal("runUploadPipeline", runUploadPipelineMock)
vi.stubGlobal("logAgent", vi.fn().mockResolvedValue(undefined))

import { executeUploadNode } from "../../../server/utils/pipeline-executors"

// ── Fixture ─────────────────────────────────────────────────────────────────
interface AccountSpec {
  platform: "instagram" | "youtube" | "tiktok"
  postingMethod: "api" | "browser_automation"
  withProxy?: boolean
}

async function createFixture(accounts: AccountSpec[]): Promise<{
  runId: number
  pipelineId: number
  videoId: number
  accountIds: number[]
  appId: number
}> {
  const seed = Math.floor(Math.random() * 1_000_000_000)

  const user = await prisma.zavodUser.create({
    data: {
      externalId: seed,
      email: `upload-test-${seed}@test`,
      rolePreset: "admin",
      canRead: true,
      canWrite: true,
      canCreate: true,
      canDelete: true,
      canApprove: true,
      canRunAgent: true,
      canApplyChanges: true,
      canAdmin: true,
      moduleAccess: ["pipeline", "social-upload"],
      isActive: true,
    },
  })
  const app = await prisma.app.create({
    data: { name: `app-${seed}`, keywords: [], forbiddenClaims: [], brandTone: "casual" },
  })
  const trend = await prisma.trend.create({
    data: {
      appId: app.id,
      platform: "instagram",
      sourceUrl: `https://test.local/${seed}`,
      title: `trend-${seed}`,
      viewCount: 1,
      hashtags: [],
    },
  })
  const scenario = await prisma.scenario.create({
    data: { trendId: trend.id, appId: app.id, status: "generated" },
  })
  const variant = await prisma.scenarioVariant.create({
    data: {
      scenario: { connect: { id: scenario.id } },
      variantIndex: 0,
      status: "accepted",
      title: "Variant headline title",
      hook: "Variant hook text",
      body: "b",
      cta: "c",
      fullScript: "f",
      visualStyleText: "v",
    },
  })
  await prisma.scenario.update({
    where: { id: scenario.id },
    data: { selectedVariantId: variant.id },
  })
  const pipeline = await prisma.pipeline.create({
    data: { userId: user.id, name: `upl-${seed}` },
  })
  const run = await prisma.workflowRun.create({
    data: { pipelineId: pipeline.id, status: "running" },
  })
  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      applicationId: app.id,
      status: "completed",
      filePath: `/tmp/video-${seed}.mp4`,
      runId: run.id,
      pipelineId: pipeline.id,
    } as never,
  })

  const accountIds: number[] = []
  for (let i = 0; i < accounts.length; i++) {
    const spec = accounts[i]!
    let proxyId: string | null = null
    if (spec.withProxy ?? spec.postingMethod === "browser_automation") {
      const proxy = await prisma.proxy.create({
        data: {
          label: `proxy-${seed}-${i}`,
          type: "residential",
          host: `127.0.0.${i + 1}`,
          port: 8080 + i,
          protocol: "http",
          status: "healthy",
          username: `u${seed}-${i}`,
          password: `p${seed}-${i}`,
          createdById: user.id,
        } as never,
      })
      proxyId = proxy.id
    }
    const account = await prisma.socialAccount.create({
      data: {
        appId: app.id,
        platform: spec.platform,
        displayName: `acc-${seed}-${i}`,
        status: "active",
        postingMethod: spec.postingMethod,
        proxyId,
      },
    })
    accountIds.push(account.id)
  }

  // Caption — по одной на (video, platform) (модель @@unique([videoId, platform])).
  // Для IG title = полный caption-текст (см. caption-limits/caption-generator).
  const uniquePlatforms = [...new Set(accounts.map((a) => a.platform))]
  for (const platform of uniquePlatforms) {
    await prisma.caption.create({
      data: {
        videoId: video.id,
        platform,
        title:
          platform === "instagram"
            ? "Полный IG caption текст для Reels 🎬"
            : "YT short headline",
        description: platform === "instagram" ? null : "yt desc",
        hashtags: ["fyp", "reels"],
        charsTitle: 10,
        charsHashtagsTotal: 10,
        fitsLimits: true,
        modelVersion: "caption-generator-v1",
        approvedAt: new Date(),
      },
    })
  }

  return {
    runId: run.id,
    pipelineId: pipeline.id,
    videoId: video.id,
    accountIds,
    appId: app.id,
  }
}

beforeEach(() => {
  createPostingJobMock.mockReset()
  assertOneToOneMock.mockReset()
  runUploadPipelineMock.mockReset()
  createPostingJobMock.mockResolvedValue({ id: "job-mock" })
  assertOneToOneMock.mockResolvedValue(undefined)
  runUploadPipelineMock.mockResolvedValue(undefined)
})

describe("executeUploadNode — развилка по postingMethod (PR5)", () => {
  it("browser_automation IG → createPostingJob с runId/pipelineId и полным IG-caption (W6)", async () => {
    const fx = await createFixture([
      { platform: "instagram", postingMethod: "browser_automation" },
    ])

    const out = await executeUploadNode(
      { accountMode: "account", socialAccountId: fx.accountIds[0] },
      { videos: [{ id: fx.videoId }], _runId: fx.runId, _pipelineId: fx.pipelineId },
    )

    // createPostingJob вызван 1 раз с корректными полями
    expect(createPostingJobMock).toHaveBeenCalledTimes(1)
    const arg = createPostingJobMock.mock.calls[0]![0]
    expect(arg.videoId).toBe(fx.videoId)
    expect(arg.socialAccountId).toBe(fx.accountIds[0])
    expect(arg.platform).toBe("instagram")
    expect(arg.runId).toBe(fx.runId)
    expect(arg.pipelineId).toBe(fx.pipelineId)
    expect(arg.scheduledAt).toBeNull()
    expect(arg.maxAttempts).toBe(3)

    // W6: contentSnapshot.caption = полный IG-текст (Caption.title), НЕ youtube title.
    expect(arg.contentSnapshot.caption).toBe("Полный IG caption текст для Reels 🎬")
    expect(arg.contentSnapshot.title).toBeUndefined()
    expect(arg.contentSnapshot.hashtags).toEqual(["fyp", "reels"])
    expect(arg.contentSnapshot.instagram).toEqual({ shareAsReel: true })

    // 1:1:1 guard вызван перед созданием
    expect(assertOneToOneMock).toHaveBeenCalledTimes(1)

    // НЕ запускали Upload-трек
    expect(runUploadPipelineMock).not.toHaveBeenCalled()
    const uploads = await prisma.upload.count()
    expect(uploads).toBe(0)

    // output отражает созданный PostingJob, без Upload
    expect(out.postingJobsCreated).toBe(1)
    expect(out.uploadsInitiated).toBe(0)
  })

  it("api-аккаунт → старый Upload-путь байт-в-байт (createPostingJob НЕ вызван)", async () => {
    const fx = await createFixture([
      { platform: "instagram", postingMethod: "api" },
    ])

    const out = await executeUploadNode(
      { accountMode: "account", socialAccountId: fx.accountIds[0] },
      { videos: [{ id: fx.videoId }], _runId: fx.runId, _pipelineId: fx.pipelineId },
    )

    // PostingJob НЕ создаётся для api
    expect(createPostingJobMock).not.toHaveBeenCalled()
    expect(assertOneToOneMock).not.toHaveBeenCalled()

    // Upload создан + runUploadPipeline вызван
    const uploads = await prisma.upload.findMany()
    expect(uploads.length).toBe(1)
    expect(uploads[0]!.videoId).toBe(fx.videoId)
    expect(runUploadPipelineMock).toHaveBeenCalledTimes(1)
    expect(runUploadPipelineMock).toHaveBeenCalledWith(uploads[0]!.id)

    expect(out.uploadsInitiated).toBe(1)
    expect(out.postingJobsCreated).toBe(0)
  })

  it("browser_automation + api в группе → каждый своим треком, без дублей", async () => {
    const fx = await createFixture([
      { platform: "instagram", postingMethod: "browser_automation" },
      { platform: "instagram", postingMethod: "api" },
    ])
    // создаём группу с двумя аккаунтами, dispatchMode=all
    const group = await prisma.accountGroup.create({
      data: {
        name: `grp-${fx.runId}`,
        dispatchMode: "all",
        app: { connect: { id: fx.appId } },
        members: {
          create: fx.accountIds.map((id) => ({ socialAccountId: id })),
        },
      } as never,
    })

    const out = await executeUploadNode(
      { accountMode: "group", accountGroupId: group.id },
      { videos: [{ id: fx.videoId }], _runId: fx.runId, _pipelineId: fx.pipelineId },
    )

    // ровно один PostingJob (browser_automation) + ровно один Upload (api)
    expect(createPostingJobMock).toHaveBeenCalledTimes(1)
    const uploads = await prisma.upload.findMany()
    expect(uploads.length).toBe(1)
    expect(runUploadPipelineMock).toHaveBeenCalledTimes(1)

    // browser_automation-аккаунт НЕ получил Upload (нет дубля по треку)
    const baAccountId = fx.accountIds[0]
    expect(uploads[0]!.socialAccountId).not.toBe(baAccountId)

    expect(out.postingJobsCreated).toBe(1)
    expect(out.uploadsInitiated).toBe(1)
  })
})
