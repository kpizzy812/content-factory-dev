/**
 * Фабрика Video с привязкой к Scenario+App для тестов captions API.
 *
 * Создаёт цепочку App → Trend → Scenario → ScenarioVariant(accepted) → Video,
 * чтобы caption-generator-agent имел полный контекст (storyPlan, app данные).
 */
import { prisma } from "../../../server/utils/prisma"
import type { Platform } from "../../../app/generated/prisma"
import type { SocialPlatform } from "../../../shared/types/caption"

interface CreateTestVideoOpts {
  appId?: number
  scenarioId?: number
  status?: "completed" | "pending" | "failed"
  targetPlatform?: SocialPlatform | null
}

export interface TestVideoBundle {
  app: Awaited<ReturnType<typeof prisma.app.create>>
  trend: Awaited<ReturnType<typeof prisma.trend.create>>
  scenario: Awaited<ReturnType<typeof prisma.scenario.create>>
  variant: Awaited<ReturnType<typeof prisma.scenarioVariant.create>>
  video: Awaited<ReturnType<typeof prisma.video.create>>
}

export async function createTestVideoWithScenario(
  opts: CreateTestVideoOpts = {},
): Promise<TestVideoBundle> {
  const seed = Math.floor(Math.random() * 1_000_000_000)

  const app = opts.appId
    ? await prisma.app.findUniqueOrThrow({ where: { id: opts.appId } })
    : await prisma.app.create({
      data: {
        name: `Test App ${seed}`,
        description: "Test app description",
        keywords: ["test", "app"],
        brandTone: "casual",
        corePain: "users waste time",
        transformationPromise: "save 1 hour daily",
        forbiddenClaims: ["medical", "guarantee"],
      },
    })

  const trend = await prisma.trend.create({
    data: {
      appId: app.id,
      platform: "tiktok",
      sourceUrl: `https://tiktok.com/@test_${seed}/video/1`,
      title: `Test Trend ${seed}`,
      description: "Test trend",
      hashtags: ["test"],
      viewCount: 100_000,
    },
  })

  const scenario = opts.scenarioId
    ? await prisma.scenario.findUniqueOrThrow({ where: { id: opts.scenarioId } })
    : await prisma.scenario.create({
      data: {
        trendId: trend.id,
        appId: app.id,
        status: "generated",
      },
    })

  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      status: "accepted",
      title: `Variant title ${seed}`,
      hook: "Hook line that grabs attention",
      body: "Body content showing the app in action",
      cta: `Try ${app.name} now`,
      fullScript: "Full script with hook, body, and CTA",
      visualStyleText: "Bright, vertical, modern",
    },
  })

  await prisma.scenario.update({
    where: { id: scenario.id },
    data: { selectedVariantId: variant.id },
  })

  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      variantId: variant.id,
      applicationId: app.id,
      status: opts.status ?? "completed",
      format: "portrait",
      filePath: opts.status === "completed" ? `videos/test-${seed}.mp4` : null,
      fileUrl: opts.status === "completed" ? `videos/test-${seed}.mp4` : null,
      duration: 30,
      targetPlatform: opts.targetPlatform ?? "tiktok",
      clipDuration: 5,
      imageCount: 6,
    },
  })

  return { app, trend, scenario, variant, video }
}

/**
 * Создаёт Caption напрямую в БД с заданными параметрами (для approve/edit тестов).
 */
export async function createTestCaption(
  videoId: number,
  platform: SocialPlatform,
  overrides: {
    title?: string
    description?: string | null
    hashtags?: string[]
    fitsLimits?: boolean
    approvedAt?: Date | null
    approvedById?: number | null
  } = {},
) {
  const title = overrides.title ?? "Test viral title for video content"
  const hashtags = overrides.hashtags ?? ["fyp", "viral", "test", "content", "shorts"]
  const charsHashtagsTotal = hashtags.length === 0
    ? 0
    : hashtags.map((h) => `#${h}`).join(" ").length

  return prisma.caption.create({
    data: {
      videoId,
      platform: platform as Platform,
      title,
      description: overrides.description ?? null,
      hashtags,
      charsTitle: title.length,
      charsHashtagsTotal,
      fitsLimits: overrides.fitsLimits ?? true,
      modelVersion: "test-mock",
      promptVersion: "v1",
      ...(overrides.approvedAt !== undefined ? { approvedAt: overrides.approvedAt } : {}),
      ...(overrides.approvedById !== undefined ? { approvedById: overrides.approvedById } : {}),
    },
  })
}
