/**
 * Seed Drive Auto-Caption pipeline template (Этап 3 Google Drive integration).
 *
 * Создаёт draft-Pipeline с 4 нодами:
 *   google_drive_scanner -> video_analyzer -> caption_generator -> upload
 *
 * Скрипт *additive* — не делает TRUNCATE, безопасен для dev-БД.
 * После создания pipeline пользователь должен:
 *   1. Подключить Google Drive Service Account на /google-drive
 *   2. Открыть /pipeline/<id>, заполнить credentialId и folderId в Drive Scanner ноде
 *   3. Активировать pipeline (status=active)
 *
 * Usage:
 *   bun run scripts/seed-drive-pipeline-template.ts <userId>
 *   bun run seed:drive-template <userId>
 */
import { prisma } from "../server/utils/prisma"

interface SeedResult {
  userId: number
  appId: number
  scenarioId: number
  pipelineId: number
  editUrl: string
}

async function main(): Promise<SeedResult> {
  const userIdRaw = process.argv[2]
  if (!userIdRaw) {
    console.error("[seed-drive-template] usage: bun run scripts/seed-drive-pipeline-template.ts <userId>")
    process.exit(1)
  }
  const userId = Number.parseInt(userIdRaw, 10)
  if (!Number.isFinite(userId) || userId <= 0) {
    console.error("[seed-drive-template] invalid userId:", userIdRaw)
    process.exit(1)
  }

  const user = await prisma.zavodUser.findUnique({ where: { id: userId }, select: { id: true, email: true } })
  if (!user) {
    console.error(`[seed-drive-template] ZavodUser id=${userId} not found`)
    process.exit(1)
  }

  // Reuse or create demo App для pipeline-template
  let app = await prisma.app.findFirst({
    where: { name: "Drive Demo App" },
    select: { id: true },
  })
  if (!app) {
    app = await prisma.app.create({
      data: {
        name: "Drive Demo App",
        description: "Demo app for Drive Auto-Caption pipeline template",
        keywords: ["drive", "creative", "viral"],
        brandTone: "casual energetic",
        corePain: "no time to write captions for every video",
        transformationPromise: "auto-generate viral captions in seconds",
        forbiddenClaims: [],
      },
      select: { id: true },
    })
  }

  // Ensure хотя бы один Trend существует — нужен под system-Scenario fallback
  // (importDriveFileToVideo требует first Trend для placeholder Scenario).
  let trend = await prisma.trend.findFirst({
    where: { appId: app.id },
    select: { id: true },
  })
  if (!trend) {
    trend = await prisma.trend.create({
      data: {
        appId: app.id,
        platform: "tiktok",
        sourceUrl: "https://example.test/drive-demo-trend",
        title: "Drive Demo Trend (system)",
        description: "System trend for Drive Auto-Caption template — placeholder",
        hashtags: [],
        viewCount: 0,
      },
      select: { id: true },
    })
  }

  // Reuse или create system-Scenario (status=archived) для creative-only flow.
  // Это совпадает с логикой importDriveFileToVideo.
  let scenario = await prisma.scenario.findFirst({
    where: {
      appId: app.id,
      operatorNotes: "__system_drive_imports",
    },
    select: { id: true },
  })
  if (!scenario) {
    scenario = await prisma.scenario.create({
      data: {
        trendId: trend.id,
        appId: app.id,
        status: "archived",
        operatorNotes: "__system_drive_imports",
      },
      select: { id: true },
    })
  }

  // Pipeline (status=inactive — пока юзер не заполнит credentialId/folderId
  // и не активирует). Enum PipelineStatus = active|inactive (нет 'draft').
  const pipeline = await prisma.pipeline.create({
    data: {
      userId,
      name: "Drive Auto-Caption (template)",
      description:
        "Сканирует Google Drive folder, анализирует видео покадрово (marketing AI) и генерирует viral captions для TikTok/YouTube. Перед запуском заполните credentialId и folderId в ноде Drive Scanner.",
      status: "inactive",
      graphData: {
        nodes: [
          {
            id: "drive-1",
            type: "default",
            position: { x: 80, y: 100 },
            data: {
              type: "google_drive_scanner",
              label: "Drive Scanner",
              config: {
                credentialId: 0,
                folderId: "PASTE_FOLDER_ID_HERE",
                onlyUnlabeled: true,
                batchSize: 10,
              },
            },
          },
          {
            id: "analyze-1",
            type: "default",
            position: { x: 360, y: 100 },
            data: {
              type: "video_analyzer",
              label: "Анализ видео",
              config: {
                force: false,
                framePassVersion: "frames-v1",
                scenarioIdForImport: scenario.id,
                applicationId: app.id,
                format: "portrait",
                maxFailures: 3,
                concurrency: 2,
              },
            },
          },
          {
            id: "caption-1",
            type: "default",
            position: { x: 640, y: 100 },
            data: {
              type: "caption_generator",
              label: "Описания",
              config: {
                platforms: ["tiktok", "youtube"],
                styleVariant: "viral",
              },
            },
          },
          {
            id: "upload-1",
            type: "default",
            position: { x: 920, y: 100 },
            data: {
              type: "upload",
              label: "Загрузка",
              config: {
                uploadPlatforms: ["tiktok", "youtube"],
                scheduledMode: "auto",
                requiresApproval: true,
              },
            },
          },
        ],
        edges: [
          { id: "e1", source: "drive-1", target: "analyze-1" },
          { id: "e2", source: "analyze-1", target: "caption-1" },
          { id: "e3", source: "caption-1", target: "upload-1" },
        ],
      },
    },
    select: { id: true },
  })

  const result: SeedResult = {
    userId,
    appId: app.id,
    scenarioId: scenario.id,
    pipelineId: pipeline.id,
    editUrl: `/pipeline/${pipeline.id}`,
  }

  console.log("[seed-drive-template] OK", JSON.stringify(result))
  console.log(
    `\nCreated pipeline #${pipeline.id}. Edit credentialId and folderId on /pipeline/${pipeline.id} after connecting Drive on /google-drive.\n`,
  )

  return result
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-drive-template] error:", err)
    process.exit(1)
  })
