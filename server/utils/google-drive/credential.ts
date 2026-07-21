/**
 * Drive credential resolver.
 *
 * Загружает PipelineCredential, расшифровывает service account JSON, обменивает
 * на access_token (с in-memory token-cache TTL 50 минут). Concurrent inflight
 * протекция через Map<credentialId, Promise<Token>> чтобы N параллельных
 * запросов на один credential делали только один JWT exchange.
 *
 * Cache invalidation: вызывать invalidateDriveTokenCache(id) при PUT/revoke
 * существующего PipelineCredential — иначе старый токен будет использован до 50м.
 */
import { decryptSecret } from "../crypto"
import { prisma } from "../prisma"
import {
  type DriveAccessToken,
  type ServiceAccountJson,
  exchangeServiceAccountForToken,
} from "./client"

const TOKEN_TTL_MS = 50 * 60_000

export interface LoadedDriveCredential {
  credentialId: number
  serviceAccount: ServiceAccountJson
  accessToken: string
  expiresAt: number
}

interface CachedTokenEntry {
  token: string
  expiresAt: number
}

const tokenCache = new Map<number, CachedTokenEntry>()
const inflight = new Map<number, Promise<DriveAccessToken>>()

export function invalidateDriveTokenCache(credentialId: number): void {
  tokenCache.delete(credentialId)
  inflight.delete(credentialId)
}

function parseServiceAccount(raw: string): ServiceAccountJson {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw createError({
      statusCode: 400,
      message: "Невалидный service account JSON: ошибка парсинга",
    })
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw createError({
      statusCode: 400,
      message: "Невалидный service account JSON: ожидается объект",
    })
  }
  const candidate = parsed as Record<string, unknown>
  if (candidate.type !== "service_account") {
    throw createError({
      statusCode: 400,
      message: "Невалидный service account JSON: type должен быть 'service_account'",
    })
  }
  if (typeof candidate.client_email !== "string" || typeof candidate.private_key !== "string") {
    throw createError({
      statusCode: 400,
      message:
        "Невалидный service account JSON: отсутствуют client_email или private_key",
    })
  }
  return parsed as ServiceAccountJson
}

function extractSecretJson(decrypted: string): string {
  // Wrapper format: { json: "<raw service account JSON>" } или сам raw JSON.
  const trimmed = decrypted.trim()
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    throw createError({ statusCode: 400, message: "Credential не парсится как JSON" })
  }
  if (typeof obj.json === "string") return obj.json
  if (obj.type === "service_account") return trimmed
  throw createError({
    statusCode: 400,
    message: "Credential не содержит поле 'json' с service account",
  })
}

async function acquireToken(
  credentialId: number,
  sa: ServiceAccountJson,
): Promise<DriveAccessToken> {
  const now = Date.now()
  const cached = tokenCache.get(credentialId)
  if (cached && cached.expiresAt > now + 30_000) {
    return { accessToken: cached.token, expiresAt: cached.expiresAt }
  }

  const existingInflight = inflight.get(credentialId)
  if (existingInflight) return existingInflight

  const promise = exchangeServiceAccountForToken(sa)
    .then((token) => {
      const cacheEntry: CachedTokenEntry = {
        token: token.accessToken,
        expiresAt: Math.min(token.expiresAt, now + TOKEN_TTL_MS),
      }
      tokenCache.set(credentialId, cacheEntry)
      return token
    })
    .finally(() => {
      inflight.delete(credentialId)
    })

  inflight.set(credentialId, promise)
  return promise
}

/**
 * Возвращает расшифрованный ServiceAccountJson для credential без обмена на токен.
 * Используется uploader'ом, которому нужен другой scope (drive.file, не readonly),
 * поэтому он сам вызывает exchangeServiceAccountForToken с нужным scope.
 *
 * Переиспользует все проверки credential (existence, revoked, expiresAt, kind),
 * чтобы не дублировать crypto-логику в нескольких местах.
 */
export async function decryptDriveServiceAccount(
  credentialId: number,
  userId: number,
): Promise<{ credentialId: number; serviceAccount: ServiceAccountJson }> {
  const cred = await prisma.pipelineCredential.findFirst({
    where: { id: credentialId, userId },
  })
  if (!cred) {
    throw createError({ statusCode: 404, message: "Credential не найден" })
  }
  if (cred.revokedAt) {
    throw createError({ statusCode: 403, message: "Credential отозван" })
  }
  if (cred.expiresAt && cred.expiresAt.getTime() < Date.now()) {
    throw createError({ statusCode: 403, message: "Credential истёк" })
  }
  const meta = (cred.metadata ?? {}) as Record<string, unknown>
  if (meta.kind !== "google_drive_service_account") {
    throw createError({
      statusCode: 400,
      message: "Credential не относится к Google Drive (metadata.kind)",
    })
  }
  const decrypted = decryptSecret(cred.encryptedData)
  const rawJson = extractSecretJson(decrypted)
  const serviceAccount = parseServiceAccount(rawJson)
  return { credentialId, serviceAccount }
}

export async function loadDriveCredential(
  credentialId: number,
  userId: number,
): Promise<LoadedDriveCredential> {
  const cred = await prisma.pipelineCredential.findFirst({
    where: { id: credentialId, userId },
  })
  if (!cred) {
    throw createError({ statusCode: 404, message: "Credential не найден" })
  }
  if (cred.revokedAt) {
    throw createError({ statusCode: 403, message: "Credential отозван" })
  }
  if (cred.expiresAt && cred.expiresAt.getTime() < Date.now()) {
    throw createError({ statusCode: 403, message: "Credential истёк" })
  }
  const meta = (cred.metadata ?? {}) as Record<string, unknown>
  if (meta.kind !== "google_drive_service_account") {
    throw createError({
      statusCode: 400,
      message: "Credential не относится к Google Drive (metadata.kind)",
    })
  }

  const decrypted = decryptSecret(cred.encryptedData)
  const rawJson = extractSecretJson(decrypted)
  const serviceAccount = parseServiceAccount(rawJson)

  const token = await acquireToken(credentialId, serviceAccount)

  await prisma.pipelineCredential
    .update({ where: { id: credentialId }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  return {
    credentialId,
    serviceAccount,
    accessToken: token.accessToken,
    expiresAt: token.expiresAt,
  }
}
