/**
 * Сидим тестовую БД для visual audit Caption Generator.
 *
 * Создаёт:
 *   - ZavodUser (admin, externalId=999) для test-bypass
 *   - App, Trend, Scenario с accepted Variant
 *   - Completed Video с filePath/fileUrl
 *   - 3 Caption (tiktok approved, youtube approved, instagram fitsLimits=false)
 *   - Pipeline с canvas-нодой caption_generator
 *
 * Запуск: bun run scripts/seed-caption-audit.ts
 */
import { prisma } from "../server/utils/prisma"

async function main() {
  // Truncate all
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `
  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ")
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
  }

  const user = await prisma.zavodUser.create({
    data: {
      externalId: 999,
      email: "audit-admin@example.test",
      name: "Audit Admin",
      rolePreset: "admin",
      canRead: true,
      canWrite: true,
      canCreate: true,
      canDelete: true,
      canApprove: true,
      canRunAgent: true,
      canApplyChanges: true,
      canAdmin: true,
      moduleAccess: [],
      appAccess: [],
      isActive: true,
    },
  })

  const app = await prisma.app.create({
    data: {
      name: "ZavodApp",
      description: "Productivity AI app for makers",
      keywords: ["productivity", "ai", "tools"],
      brandTone: "casual energetic",
      corePain: "users waste hours on context switching",
      transformationPromise: "save 1 hour every day",
      forbiddenClaims: ["medical", "guarantee"],
    },
  })

  const trend = await prisma.trend.create({
    data: {
      appId: app.id,
      platform: "tiktok",
      sourceUrl: "https://tiktok.com/@audit/1",
      title: "POV: trying productivity hack",
      description: "Trend description",
      hashtags: ["productivity"],
      viewCount: 1_500_000,
    },
  })

  const scenario = await prisma.scenario.create({
    data: {
      trendId: trend.id,
      appId: app.id,
      status: "selected",
    },
  })

  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      status: "accepted",
      title: "I tried this AI app for 7 days",
      hook: "Question that grabs attention immediately",
      body: "Body content showing the app in action solving the user's problem",
      cta: "Try ZavodApp now and save an hour every day",
      fullScript: "Hook → Body → CTA full script content",
      visualStyleText: "Bright, vertical, modern, clean",
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
      status: "completed",
      format: "portrait",
      filePath: "videos/audit-stub.mp4",
      fileUrl: "videos/audit-stub.mp4",
      duration: 30,
      targetPlatform: "tiktok",
      clipDuration: 5,
      imageCount: 6,
    },
  })

  // Captions: tiktok approved (зелёный), youtube approved, instagram over-limits (красный)
  await prisma.caption.create({
    data: {
      videoId: video.id,
      platform: "tiktok",
      title: "I tried this AI app for 7 days — the result shocked me 😱",
      description: "POV: you finally found the productivity app that actually works.",
      hashtags: ["fyp", "viral", "productivityhack", "lifehack", "ZavodApp"],
      charsTitle: 56,
      charsHashtagsTotal: 56,
      fitsLimits: true,
      modelVersion: "caption-generator-v1",
      promptVersion: "v1",
      generatedById: user.id,
      approvedAt: new Date(),
      approvedById: user.id,
    },
  })

  await prisma.caption.create({
    data: {
      videoId: video.id,
      platform: "youtube",
      title: "I Used This AI App for a Week - Here's What Happened",
      description:
        "Personal experiment with a new AI productivity tool. Real results, no sponsorship.\n\nGet ZavodApp here: https://example.com",
      hashtags: ["shorts", "ai", "productivity", "tech", "review", "lifehack", "ZavodApp", "experiment"],
      charsTitle: 53,
      charsHashtagsTotal: 80,
      fitsLimits: true,
      modelVersion: "caption-generator-v1",
      promptVersion: "v1",
      generatedById: user.id,
    },
  })

  // Instagram: специально over-limits для демонстрации алерта
  const tooManyTags = [
    "averylonghashtagonethatislong",
    "anotherverylonghashtagextra",
    "thirdsuperlonghashtagforinstagram",
    "fourthlongtagextra",
    "fifthsuperlongextrahashtag",
  ]
  const totalLen = tooManyTags.map((h) => `#${h}`).join(" ").length
  await prisma.caption.create({
    data: {
      videoId: video.id,
      platform: "instagram",
      title:
        "7 days. One AI app. The result will absolutely shock you - watch till the end and prepare to be amazed by transformation",
      description: "Tested ZavodApp for a week.",
      hashtags: tooManyTags,
      charsTitle: 130, // > 125 limit
      charsHashtagsTotal: totalLen,
      fitsLimits: false,
      modelVersion: "caption-generator-v1",
      promptVersion: "v1",
      generatedById: user.id,
    },
  })

  // Pipeline с caption_generator нодой
  const pipeline = await prisma.pipeline.create({
    data: {
      userId: user.id,
      name: "Caption Generator Audit Pipeline",
      description: "Test pipeline with all main blocks plus caption generator",
      status: "active",
      graphData: {
        nodes: [
          {
            id: "trendwatcher-1",
            type: "default",
            position: { x: 80, y: 100 },
            data: { type: "trendwatcher", label: "Трендвотчер", config: {} },
          },
          {
            id: "scenario-1",
            type: "default",
            position: { x: 320, y: 100 },
            data: { type: "scenario", label: "Сценарии", config: { variantsCount: 3 } },
          },
          {
            id: "video-1",
            type: "default",
            position: { x: 560, y: 100 },
            data: { type: "video", label: "Видео", config: {} },
          },
          {
            id: "caption-1",
            type: "default",
            position: { x: 800, y: 100 },
            data: {
              type: "caption_generator",
              label: "Описания",
              config: {
                platforms: ["tiktok", "youtube", "instagram"],
                styleVariant: "viral",
              },
            },
          },
          {
            id: "upload-1",
            type: "default",
            position: { x: 1040, y: 100 },
            data: { type: "upload", label: "Загрузка", config: {} },
          },
        ],
        edges: [
          { id: "e1", source: "trendwatcher-1", target: "scenario-1" },
          { id: "e2", source: "scenario-1", target: "video-1" },
          { id: "e3", source: "video-1", target: "caption-1" },
          { id: "e4", source: "caption-1", target: "upload-1" },
        ],
      },
    },
  })

  console.log("[seed-caption-audit] OK", {
    userId: user.id,
    appId: app.id,
    videoId: video.id,
    pipelineId: pipeline.id,
  })

  process.exit(0)
}

main().catch((e) => {
  console.error("[seed-caption-audit] error:", e)
  process.exit(1)
})
