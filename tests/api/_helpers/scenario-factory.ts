/**
 * Фабрика для создания Scenario с вариантами в тестовой БД.
 *
 * Использование:
 *   const { scenario, variants } = await createTestScenarioWithVariants({ variantsCount: 3 })
 */
import { prisma } from "../../../server/utils/prisma"

interface CreateTestScenarioWithVariantsOpts {
  appId?: number
  trendId?: number
  variantsCount?: number
  /** Если true — scenario.selectedVariantId будет установлен на первый вариант */
  preSelectFirstVariant?: boolean
}

interface ScenarioWithVariants {
  app: Awaited<ReturnType<typeof prisma.app.create>>
  trend: Awaited<ReturnType<typeof prisma.trend.create>>
  scenario: Awaited<ReturnType<typeof prisma.scenario.create>>
  variants: Awaited<ReturnType<typeof prisma.scenarioVariant.findMany>>
}

export async function createTestScenarioWithVariants(
  opts: CreateTestScenarioWithVariantsOpts = {},
): Promise<ScenarioWithVariants> {
  const seed = Math.floor(Math.random() * 1_000_000_000)

  // App
  const app = await prisma.app.create({
    data: {
      name: `Test App ${seed}`,
      description: "Test app description",
      keywords: ["test", "app"],
    },
  })

  // Trend
  const trend = await prisma.trend.create({
    data: {
      appId: opts.appId ?? app.id,
      platform: "tiktok",
      sourceUrl: `https://tiktok.com/@test_${seed}/video/1`,
      title: `Test Trend ${seed}`,
      description: "Test trend description for quality critic tests",
      hashtags: ["test", "critic"],
      viewCount: 100_000,
    },
  })

  // Scenario
  const scenario = await prisma.scenario.create({
    data: {
      trendId: opts.trendId ?? trend.id,
      appId: opts.appId ?? app.id,
      status: "generated",
    },
  })

  // ScenarioVariants
  const count = opts.variantsCount ?? 3
  await prisma.scenarioVariant.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      scenarioId: scenario.id,
      variantIndex: i,
      title: `Variant ${i} title — seed ${seed}`,
      hook: `Hook for variant ${i}: вопрос или контраст для привлечения внимания`,
      body: `Body for variant ${i}: основная часть сценария с развитием истории и демонстрацией приложения`,
      cta: `CTA for variant ${i}: скачай приложение прямо сейчас и начни`,
      fullScript: `Full script for variant ${i}:\nСцена 1: ${`Hook for variant ${i}`}\nСцена 2: ${`Body for variant ${i}`}\nСцена 3: ${`CTA for variant ${i}`}`,
      visualStyleText: `Visual style for variant ${i}: bright, modern, vertical format`,
    })),
  })

  const variants = await prisma.scenarioVariant.findMany({
    where: { scenarioId: scenario.id },
    orderBy: { variantIndex: "asc" },
  })

  if (opts.preSelectFirstVariant && variants.length > 0) {
    await prisma.scenario.update({
      where: { id: scenario.id },
      data: { selectedVariantId: variants[0]!.id },
    })
    return {
      app,
      trend,
      scenario: await prisma.scenario.findUniqueOrThrow({ where: { id: scenario.id } }),
      variants,
    }
  }

  return { app, trend, scenario, variants }
}

/**
 * Создаёт CriticReview напрямую в БД для тестов rate-limit и GET-списка.
 */
export async function createTestCriticReview(
  scenarioId: number,
  iteration: number,
  overrides: {
    needsRework?: boolean
    reachedThreshold?: boolean
    averageScore?: number
    createdAt?: Date
  } = {},
) {
  return prisma.criticReview.create({
    data: {
      scenarioId,
      iteration,
      variantsReviewed: 3,
      bestVariantId: null,
      averageScore: overrides.averageScore ?? 75,
      needsRework: overrides.needsRework ?? false,
      reachedThreshold: overrides.reachedThreshold ?? true,
      fullReport: {
        scores: [],
        bestVariantIndex: 0,
        bestVariantId: null,
        averageScore: overrides.averageScore ?? 75,
        needsRework: overrides.needsRework ?? false,
        reasoning: "Test review",
      },
      modelVersion: "sonnet-4",
      promptVersion: "critic-v1",
      durationMs: 1000,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  })
}
