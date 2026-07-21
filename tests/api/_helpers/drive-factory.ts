/**
 * Фабрика тестовых сущностей Google Drive — credentials и DriveFile.
 *
 * Генерирует валидную RSA-пару для подписи JWT (Service Account flow)
 * и шифрует JSON через testEncrypt → формат, читаемый decryptSecret в API.
 *
 * Mock-сервер `bun run mock:drive` должен слушать localhost:18889 при запуске
 * тестов: GOOGLE_DRIVE_MOCK_MODE=true в nuxt-env.ts заменит token endpoint и
 * baseUrl на http://localhost:18889 (см. server/utils/google-drive/client.ts).
 */
import { generateKeyPairSync } from "node:crypto"
import type { Prisma, DriveSyncStatus } from "@prisma/client"
import { prisma } from "../../../server/utils/prisma"
import { testEncrypt } from "../../helpers/test-crypto"

let cachedKeyPair: { privateKey: string, publicKey: string } | null = null

function getOrCreateKeyPair(): { privateKey: string, publicKey: string } {
  if (cachedKeyPair) return cachedKeyPair
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  cachedKeyPair = { privateKey, publicKey }
  return cachedKeyPair
}

export interface MockServiceAccountOptions {
  clientEmail?: string
  projectId?: string
}

/**
 * Создаёт строку валидного Service Account JSON с реальной RSA-парой.
 * Используется для тестов JWT flow в mock-режиме (наш mock-сервер не верифицирует подпись).
 */
export function buildMockServiceAccountJson(opts: MockServiceAccountOptions = {}): string {
  const { privateKey } = getOrCreateKeyPair()
  return JSON.stringify({
    type: "service_account",
    project_id: opts.projectId ?? "zc-test-project",
    private_key_id: "test-key-id-1",
    private_key: privateKey,
    client_email: opts.clientEmail ?? "zc-test@zc-test-project.iam.gserviceaccount.com",
    client_id: "100000000000000000001",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url:
      "https://www.googleapis.com/robot/v1/metadata/x509/zc-test%40zc-test-project.iam.gserviceaccount.com",
    universe_domain: "googleapis.com",
  })
}

export interface CreateTestDriveCredentialOpts {
  userId: number
  name?: string
  description?: string | null
  serviceAccountJson?: string
  metadata?: Prisma.JsonObject
  revokedAt?: Date | null
  expiresAt?: Date | null
  clientEmail?: string
  projectId?: string
}

/**
 * Создаёт PipelineCredential с metadata.kind=google_drive_service_account и
 * зашифрованным валидным SA JSON. Возвращает запись из БД.
 */
export async function createTestDriveCredential(opts: CreateTestDriveCredentialOpts) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const json =
    opts.serviceAccountJson ??
    buildMockServiceAccountJson({
      clientEmail: opts.clientEmail,
      projectId: opts.projectId,
    })

  // Wrapper-формат как в useGoogleDrive.createCredential: { json: "<raw SA JSON>" }
  // Это совпадает с тем что сохраняет API endpoint POST /api/pipelines/credentials.
  const wrappedSecret = JSON.stringify({ json })
  const encryptedData = testEncrypt(wrappedSecret)

  const baseMetadata: Prisma.JsonObject = {
    kind: "google_drive_service_account",
    clientEmail: opts.clientEmail ?? "zc-test@zc-test-project.iam.gserviceaccount.com",
    projectId: opts.projectId ?? "zc-test-project",
    fields: ["json"],
    ...(opts.metadata ?? {}),
  }

  return prisma.pipelineCredential.create({
    data: {
      userId: opts.userId,
      name: opts.name ?? `Test Drive Cred ${seed}`,
      description: opts.description ?? null,
      type: "custom",
      encryptedData,
      metadata: baseMetadata,
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revokedAt ?? null,
    },
  })
}

export interface CreateTestDriveFileOpts {
  credentialId: number
  userId: number
  driveFileId?: string
  name?: string
  mimeType?: string
  sizeBytes?: number | bigint | null
  syncStatus?: DriveSyncStatus
  localPath?: string | null
  videoId?: number | null
  driveUrl?: string | null
  thumbnailUrl?: string | null
  hasGeneratedCaption?: boolean
}

/**
 * Создаёт DriveFile в БД. По умолчанию syncStatus='detected', mp4-видеофайл
 * с одним из mock-driveFileId ("mock-video-1" по умолчанию).
 */
export async function createTestDriveFile(opts: CreateTestDriveFileOpts) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.driveFile.create({
    data: {
      credentialId: opts.credentialId,
      userId: opts.userId,
      driveFileId: opts.driveFileId ?? "mock-video-1",
      name: opts.name ?? `creative-${seed}.mp4`,
      mimeType: opts.mimeType ?? "video/mp4",
      sizeBytes:
        opts.sizeBytes === undefined ? BigInt(5_000_000) : opts.sizeBytes === null ? null : BigInt(opts.sizeBytes),
      driveUrl:
        opts.driveUrl ?? `https://drive.google.com/file/d/${opts.driveFileId ?? "mock-video-1"}/view`,
      thumbnailUrl: opts.thumbnailUrl ?? null,
      videoId: opts.videoId ?? null,
      syncStatus: opts.syncStatus ?? "detected",
      localPath: opts.localPath ?? null,
      hasGeneratedCaption: opts.hasGeneratedCaption ?? false,
      lastSyncedAt: new Date(),
    },
  })
}
