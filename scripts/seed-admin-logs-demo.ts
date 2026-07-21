/**
 * Seed demo data for /admin/logs visual testing.
 *
 * Создаёт записи в каждой из 8 таблиц логов (AgentLog, AppEnrichmentLog,
 * SecretAccessLog, TelegramCommandAudit, TrendwatcherRunLog, WebhookLog,
 * AiAuditLog, PostingJobLog) — чтобы Playwright-скриншоты показывали
 * реальные строки из всех источников. Использовать ТОЛЬКО на test БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-admin-logs-demo.ts
 */

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"

const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter: pool })

async function main() {
  if (!process.env.DATABASE_URL?.includes("tests")) {
    throw new Error(
      "[seed-admin-logs-demo] DATABASE_URL не указывает на test БД. Прерываю.",
    )
  }

  console.log(`[seed] DB: ${process.env.DATABASE_URL}`)

  // Test admin user (для SecretAccessLog/AiAuditLog нужен userId)
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const user = await prisma.zavodUser.upsert({
    where: { email: "logs-demo@example.test" },
    update: {},
    create: {
      externalId: seed,
      email: "logs-demo@example.test",
      name: "Logs Demo",
      rolePreset: "admin",
      canRead: true,
      canWrite: true,
      canCreate: true,
      canDelete: true,
      canApprove: true,
      canRunAgent: true,
      canApplyChanges: true,
      canAdmin: true,
      moduleAccess: [
        "trendwatcher",
        "script-generator",
        "video-generator",
        "social-upload",
        "analytics",
        "pipeline",
      ],
      isActive: true,
    },
  })

  // Минимальные сущности-владельцы (App, Pipeline, TrendwatcherRun, ProductionCycle, PostingJob) —
  // только если их нет.
  let app = await prisma.app.findFirst({ where: { name: "Demo App" } })
  if (!app) {
    app = await prisma.app.create({
      data: { name: "Demo App", description: "Демо для логов" },
    })
  }

  let pipeline = await prisma.pipeline.findFirst({ where: { name: "Demo Pipeline" } })
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: {
        userId: user.id,
        name: "Demo Pipeline",
        description: "Демонстрационный пайплайн для логов",
      },
    })
  }

  // ProductionCycle (для AgentLog.cycleId)
  let cycle = await prisma.productionCycle.findFirst({
    where: { appId: app.id, status: "completed" },
  })
  if (!cycle) {
    cycle = await prisma.productionCycle.create({
      data: { appId: app.id, status: "completed", startedById: user.id },
    })
  }

  // TrendwatcherProfile + TrendwatcherRun (для TrendwatcherRunLog)
  let twProfile = await prisma.trendwatcherProfile.findFirst({ where: { appId: app.id } })
  if (!twProfile) {
    twProfile = await prisma.trendwatcherProfile.create({
      data: {
        appId: app.id,
        name: "Demo TW Profile",
        platforms: ["tiktok"],
        keywords: ["ai", "demo"],
      },
    })
  }

  let twRun = await prisma.trendwatcherRun.findFirst({ where: { profileId: twProfile.id } })
  if (!twRun) {
    twRun = await prisma.trendwatcherRun.create({
      data: {
        profileId: twProfile.id,
        status: "completed",
      },
    })
  }

  // PostingJob требует video + socialAccount + idempotencyKey + contentSnapshot —
  // в test БД этих сущностей нет, демо-сид только для логов.
  // PostingJobLog пропускаем (он показывается в UI как «нет записей по источнику»).
  const job: { id: string } | null = null

  // ---------- 1) AgentLog (8 записей разных уровней)
  await prisma.agentLog.createMany({
    data: [
      {
        cycleId: cycle.id,
        module: "orchestrator",
        level: "info",
        message: "Цикл запущен по расписанию",
        details: { trigger: "schedule", at: new Date().toISOString() },
        resolved: false,
      },
      {
        cycleId: cycle.id,
        module: "trendwatcher",
        level: "info",
        message: "Получено 12 новых трендов из Apify",
        details: { count: 12, source: "apify" },
        resolved: false,
      },
      {
        cycleId: cycle.id,
        module: "script-generator",
        level: "warn",
        message: "AI вернул сценарий с предупреждением о токенах",
        details: { tokensUsed: 15820, max: 16000 },
        resolved: false,
      },
      {
        cycleId: cycle.id,
        module: "video-generator",
        level: "error",
        message: "fal.ai превысил timeout (20m), задача переотправлена",
        details: { jobId: "fal_xyz", elapsedSec: 1230 },
        resolved: false,
      },
      {
        cycleId: null,
        module: "social-upload",
        level: "error",
        message: "TikTok upload failed: 401 unauthorized",
        details: { accountId: 42, errorCode: 401 },
        resolved: true,
      },
      {
        cycleId: cycle.id,
        module: "analytics",
        level: "info",
        message: "Сводка по аккаунту собрана",
        details: { videosWatched: 6, retentionAvg: 0.42 },
        resolved: false,
      },
    ],
  })

  // ---------- 2) AppEnrichmentLog
  await prisma.appEnrichmentLog.createMany({
    data: [
      {
        appId: app.id,
        sourceUrl: "https://apps.apple.com/us/app/demo/id123",
        platform: "app_store",
        status: "success",
        parsedData: { title: "Demo", rating: 4.8 },
      },
      {
        appId: app.id,
        sourceUrl: "https://play.google.com/store/apps/details?id=demo",
        platform: "google_play",
        status: "partial",
        errorMessage: "iconUrl не извлечён, остальные поля ок",
      },
      {
        appId: app.id,
        sourceUrl: "https://apps.apple.com/us/app/broken/id999",
        platform: "app_store",
        status: "failed",
        errorMessage: "404 Not Found на странице магазина",
      },
    ],
  })

  // ---------- 3) SecretAccessLog
  await prisma.secretAccessLog.createMany({
    data: [
      {
        userId: user.id,
        entityType: "SocialAccount.password",
        entityId: "42",
        action: "use_in_session",
        clientIp: "127.0.0.1",
        userAgent: "Test-Browser/1.0",
        reason: "TikTok upload via Indigo",
      },
      {
        userId: user.id,
        entityType: "Proxy.password",
        entityId: "abc-123",
        action: "view",
        reason: "Admin viewing proxy details",
      },
    ],
  })

  // TelegramChat — FK для TelegramCommandAudit
  for (const chatId of ["100200300", "100200301", "100200302"]) {
    await prisma.telegramChat.upsert({
      where: { chatId },
      update: {},
      create: { chatId, chatType: "private", title: `Demo chat ${chatId}` },
    })
  }

  // ---------- 4) TelegramCommandAudit
  await prisma.telegramCommandAudit.createMany({
    data: [
      {
        chatId: "100200300",
        telegramUserId: "7654321",
        telegramUsername: "demo_user",
        command: "stats",
        resultStatus: "success",
      },
      {
        chatId: "100200301",
        telegramUserId: "7654322",
        telegramUsername: "anon",
        command: "delete_cycle",
        parsedArgs: "cycleId=99",
        resultStatus: "unauthorized",
        errorMessage: "Чат не привязан к admin-аккаунту",
      },
      {
        chatId: "100200302",
        telegramUsername: "tester",
        command: "cycle_status",
        parsedArgs: "id=12345",
        resultStatus: "not_found",
        errorMessage: "Цикл #12345 не найден",
      },
    ],
  })

  // ---------- 5) TrendwatcherRunLog
  await prisma.trendwatcherRunLog.createMany({
    data: [
      {
        runId: twRun.id,
        level: "info",
        step: "fetch",
        message: "Apify actor запущен, ждём результаты",
      },
      {
        runId: twRun.id,
        level: "warn",
        step: "parse",
        message: "3 видео без описания, пропускаем",
        payload: { skipped: 3 },
      },
    ],
  })

  // ---------- 6) WebhookLog
  await prisma.webhookLog.createMany({
    data: [
      {
        pipelineId: pipeline.id,
        sourceIp: "1.2.3.4",
        userAgent: "GitHub-Hookshot/abc",
        statusCode: 200,
        payload: { event: "push" },
      },
      {
        pipelineId: pipeline.id,
        sourceIp: "5.6.7.8",
        statusCode: 401,
        errorMsg: "Invalid webhook secret",
      },
      {
        pipelineId: pipeline.id,
        sourceIp: "9.10.11.12",
        statusCode: 302,
        errorMsg: "Redirect to canonical URL",
      },
    ],
  })

  // ---------- 7) AiAuditLog
  await prisma.aiAuditLog.createMany({
    data: [
      {
        userId: user.id,
        action: "block_suggest",
        nodeType: "Trendwatcher",
        pipelineId: pipeline.id,
        nodeCanvasId: "trendwatcher-1712345-1",
        model: "claude-opus-4-7",
        prompt: "Подбери параметры трендвотчера для tech-вертикали",
        suggestions: { keywords: ["AI", "GPT-5"] },
        status: "applied",
      },
      {
        userId: user.id,
        action: "field_suggest",
        nodeType: "Upload",
        pipelineId: pipeline.id,
        model: "claude-sonnet-4-6",
        prompt: "Подбери description для TikTok",
        suggestions: { description: "Smash like!" },
        status: "dismissed",
      },
    ],
  })

  // ---------- 8) PostingJobLog (если job есть)
  if (job) {
    await prisma.postingJobLog.createMany({
      data: [
        {
          jobId: job.id,
          level: "info",
          message: "Job created and queued",
        },
        {
          jobId: job.id,
          level: "warn",
          message: "Retry attempt #1 after transient API error",
          data: { attempt: 1 },
        },
        {
          jobId: job.id,
          level: "error",
          message: "Final failure: TikTok rejected video format",
          data: { code: "INVALID_FORMAT" },
        },
      ],
    })
  }

  console.log(`[seed] Done. User: ${user.email} (id=${user.id})`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
