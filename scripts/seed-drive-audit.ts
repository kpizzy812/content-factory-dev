/**
 * Seed для visual audit трёх этапов Google Drive Auto-Caption Pipeline.
 *
 * Создаёт:
 *   - ZavodUser (admin, externalId=998, email=audit-drive@example.test)
 *   - App "Drive Audit App" с targetAudience/geo
 *   - Trend (минимальный, нужен для FK Scenario)
 *   - System-Scenario для Drive imports (operatorNotes='__system_drive_imports')
 *   - PipelineCredential для Drive (Service Account JSON, mock-валидный)
 *   - 3 DriveFile в разных syncStatus (detected, downloaded, imported_to_video)
 *   - 1 Video с analysisData (для проверки Caption integration)
 *   - VideoFrame[] для импортированного Video
 *   - Pipeline через seed-drive-pipeline-template logic (status=inactive, 4 ноды)
 *
 * Запуск: bun run scripts/seed-drive-audit.ts
 *
 * После: подключиться через /api/_test/login (TEST_AUTH_BYPASS=1) с email=audit-drive@example.test
 */
import { createCipheriv, generateKeyPairSync, randomBytes } from "node:crypto"
import { prisma } from "../server/utils/prisma"

function encryptInline(plain: string): string {
  const keyHex = process.env.ENCRYPTION_KEY ?? ""
  if (keyHex.length !== 64) {
    throw new Error("ENCRYPTION_KEY должен быть 64 hex символа (32 байта)")
  }
  const key = Buffer.from(keyHex, "hex")
  const iv = randomBytes(16)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`
}

async function main() {
  // Truncate всех таблиц кроме _prisma_migrations для чистого старта
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `
  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ")
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
    console.log(`Truncated ${tables.length} tables`)
  }

  // 1. ZavodUser
  const user = await prisma.zavodUser.create({
    data: {
      externalId: 998,
      email: "audit-drive@example.test",
      name: "Drive Audit",
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
  console.log(`Created user #${user.id} (${user.email})`)

  // 2. App
  const app = await prisma.app.create({
    data: {
      name: "Drive Audit App",
      description: "Test app for Drive Auto-Caption pipeline audit",
      keywords: ["productivity", "ai"],
      targetAudience: "Gen Z creators 18-25",
      geo: "US, EU",
    },
  })
  console.log(`Created app #${app.id}`)

  // 3. Trend (минимальный, нужен для Scenario FK)
  const trend = await prisma.trend.create({
    data: {
      title: "Drive Audit Trend",
      description: "Synthetic trend for audit",
      platform: "tiktok",
      status: "completed",
      sourceUrl: "https://example.test/drive-audit-trend",
    },
  })
  console.log(`Created trend #${trend.id}`)

  // 4. System Scenario для Drive imports
  const scenario = await prisma.scenario.create({
    data: {
      operatorNotes: "__system_drive_imports",
      status: "archived",
      appId: app.id,
      trendId: trend.id,
    },
  })
  console.log(`Created system scenario #${scenario.id}`)

  // 5. Drive credential — реальная RSA-пара чтобы JWT подписался в mock-режиме
  const { privateKey: rsaPrivateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  const mockSaJson = JSON.stringify({
    type: "service_account",
    project_id: "drive-audit-project",
    private_key_id: "audit-key-id",
    private_key: rsaPrivateKey,
    client_email: "drive-audit@drive-audit-project.iam.gserviceaccount.com",
    client_id: "100000000000000000001",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  })
  const credential = await prisma.pipelineCredential.create({
    data: {
      userId: user.id,
      name: "Drive Audit Account",
      type: "custom",
      encryptedData: encryptInline(JSON.stringify({ json: mockSaJson })),
      metadata: {
        kind: "google_drive_service_account",
        clientEmail: "drive-audit@drive-audit-project.iam.gserviceaccount.com",
        projectId: "drive-audit-project",
      },
      description: "Mock Service Account для аудита трёх этапов",
    },
  })
  console.log(`Created Drive credential #${credential.id}`)

  // 6. DriveFile records (разные статусы)
  const driveFiles = await Promise.all([
    prisma.driveFile.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        driveFileId: "mock-video-detected-1",
        name: "creative-001-detected.mp4",
        mimeType: "video/mp4",
        sizeBytes: BigInt(5_000_000),
        driveCreatedAt: new Date("2026-05-01T10:00:00Z"),
        driveModifiedAt: new Date("2026-05-01T10:00:00Z"),
        driveUrl: "https://drive.google.com/file/d/mock-video-detected-1/view",
        thumbnailUrl: "https://drive.google.com/thumbnail?id=mock-video-detected-1",
        syncStatus: "detected",
        hasGeneratedCaption: false,
      },
    }),
    prisma.driveFile.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        driveFileId: "mock-video-downloaded-2",
        name: "creative-002-downloaded.mp4",
        mimeType: "video/mp4",
        sizeBytes: BigInt(7_500_000),
        driveCreatedAt: new Date("2026-05-02T10:00:00Z"),
        driveModifiedAt: new Date("2026-05-02T10:00:00Z"),
        driveUrl: "https://drive.google.com/file/d/mock-video-downloaded-2/view",
        thumbnailUrl: "https://drive.google.com/thumbnail?id=mock-video-downloaded-2",
        syncStatus: "downloaded",
        localPath: "storage/uploads/drive-imports/mock-video-downloaded-2_creative-002-downloaded.mp4",
        hasGeneratedCaption: false,
        lastSyncedAt: new Date(),
      },
    }),
    prisma.driveFile.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        driveFileId: "mock-video-failed-3",
        name: "creative-003-failed.mp4",
        mimeType: "video/mp4",
        sizeBytes: BigInt(3_000_000),
        driveCreatedAt: new Date("2026-05-03T10:00:00Z"),
        driveModifiedAt: new Date("2026-05-03T10:00:00Z"),
        driveUrl: "https://drive.google.com/file/d/mock-video-failed-3/view",
        thumbnailUrl: null,
        syncStatus: "failed",
        syncError: "Превышен лимит 500MB при скачивании",
        hasGeneratedCaption: false,
      },
    }),
  ])
  console.log(`Created ${driveFiles.length} DriveFile records`)

  // 7. Pipeline draft (Drive Auto-Caption template) — graph хранится в Pipeline.data Json
  const pipeline = await prisma.pipeline.create({
    data: {
      userId: user.id,
      name: "Drive Auto-Caption (Audit)",
      description:
        "Сканирует Drive folder, анализирует видео покадрово и генерирует viral captions",
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
                credentialId: credential.id,
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
  })
  console.log(`Created pipeline #${pipeline.id} с 4 нодами + 3 edges`)

  console.log("\n✅ Seed completed")
  console.log(`  user: #${user.id} (${user.email})`)
  console.log(`  app: #${app.id} (${app.name})`)
  console.log(`  credential: #${credential.id} (${credential.name})`)
  console.log(`  drive files: ${driveFiles.length} (detected/downloaded/failed)`)
  console.log(`  pipeline: #${pipeline.id} (4 nodes, 3 edges)`)
  console.log(`\nLogin via POST /api/_test/login with body { email: "${user.email}" } and header x-test-auth-token`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
