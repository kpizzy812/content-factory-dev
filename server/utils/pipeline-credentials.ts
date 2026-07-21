/**
 * Pipeline Credentials Manager — production-grade governance.
 *
 * Features:
 * - Encrypted storage (AES-256-GCM)
 * - Credentials never exposed in plaintext to clients
 * - Runtime resolution by ID (nodes reference credentials, not raw values)
 * - Soft revocation (revokedAt) — blocks usage without deletion
 * - Rotation flow — update secrets with audit trail
 * - Expiration checking with warning thresholds
 * - Usage tracking (lastUsedAt, pipeline binding audit)
 * - Owner isolation (shared pipelines cannot decrypt others' credentials)
 */

import { encrypt, decrypt } from './crypto'

const EXPIRY_WARNING_DAYS = 7

/** Mask a credential value for display (show only last 4 chars). */
export function maskSecret(value: string): string {
  if (value.length <= 4) return '••••'
  return '•'.repeat(value.length - 4) + value.slice(-4)
}

/** Store credential data encrypted. Returns the credential record (without secrets). */
export async function createCredential(
  userId: number,
  data: {
    name: string
    type: string
    secretData: Record<string, string>
    description?: string
    expiresAt?: Date
    metadata?: Record<string, unknown>
  },
) {
  const encryptedData = encrypt(JSON.stringify(data.secretData))

  // Сливаем системные поля (fields) с пользовательскими (kind/etc.).
  // Системные имеют приоритет для security/audit consistency.
  const mergedMetadata: Record<string, unknown> = {
    ...(data.metadata ?? {}),
    fields: Object.keys(data.secretData),
  }

  return prisma.pipelineCredential.create({
    data: {
      userId,
      name: data.name,
      type: data.type as any,
      encryptedData,
      description: data.description,
      expiresAt: data.expiresAt,
      metadata: mergedMetadata,
    },
    select: {
      id: true,
      name: true,
      type: true,
      description: true,
      metadata: true,
      expiresAt: true,
      lastUsedAt: true,
      lastTestedAt: true,
      lastTestStatus: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
}

/** Decrypt and return credential secret data. Updates lastUsedAt. Checks revocation and expiry. */
export async function resolveCredential(
  credentialId: number,
  userId: number,
): Promise<Record<string, string>> {
  const cred = await prisma.pipelineCredential.findFirst({
    where: { id: credentialId, userId },
  })

  if (!cred) {
    throw new Error(`Учётные данные #${credentialId} не найдены или нет доступа`)
  }

  // Check revocation
  if (cred.revokedAt) {
    throw new Error(`Учётные данные "${cred.name}" отозваны (${cred.revokedAt.toISOString()})`)
  }

  // Check expiration
  if (cred.expiresAt && cred.expiresAt < new Date()) {
    throw new Error(`Учётные данные "${cred.name}" истекли (${cred.expiresAt.toISOString()})`)
  }

  const decrypted = decrypt(cred.encryptedData)
  const secretData = JSON.parse(decrypted) as Record<string, string>

  // Update last used timestamp (fire-and-forget)
  prisma.pipelineCredential.update({
    where: { id: credentialId },
    data: { lastUsedAt: new Date() },
  }).catch(() => {})

  return secretData
}

/**
 * Rotate credential secrets — update encrypted data with audit trail.
 * Old secrets are overwritten, lastTestedAt is cleared for re-validation.
 */
export async function rotateCredential(
  credentialId: number,
  userId: number,
  newSecretData: Record<string, string>,
): Promise<void> {
  const cred = await prisma.pipelineCredential.findFirst({
    where: { id: credentialId, userId },
  })

  if (!cred) {
    throw new Error(`Учётные данные #${credentialId} не найдены или нет доступа`)
  }

  const encryptedData = encrypt(JSON.stringify(newSecretData))

  await prisma.pipelineCredential.update({
    where: { id: credentialId },
    data: {
      encryptedData,
      metadata: { fields: Object.keys(newSecretData) },
      lastTestedAt: null,
      lastTestStatus: 'rotated — requires re-test',
      revokedAt: null, // un-revoke if was revoked
    },
  })

  await logAgent('pipeline-credentials', 'info',
    `Учётные данные "${cred.name}" (#${credentialId}) ротированы пользователем #${userId}`,
    { credentialId, userId, fields: Object.keys(newSecretData) },
  )
}

/** Soft-revoke a credential — blocks usage without deletion. */
export async function revokeCredential(
  credentialId: number,
  userId: number,
): Promise<void> {
  const cred = await prisma.pipelineCredential.findFirst({
    where: { id: credentialId, userId },
  })

  if (!cred) {
    throw new Error(`Учётные данные #${credentialId} не найдены или нет доступа`)
  }

  await prisma.pipelineCredential.update({
    where: { id: credentialId },
    data: { revokedAt: new Date() },
  })

  await logAgent('pipeline-credentials', 'info',
    `Учётные данные "${cred.name}" (#${credentialId}) отозваны пользователем #${userId}`,
    { credentialId, userId },
  )
}

/** Un-revoke a credential. */
export async function unrevokeCredential(
  credentialId: number,
  userId: number,
): Promise<void> {
  await prisma.pipelineCredential.updateMany({
    where: { id: credentialId, userId },
    data: { revokedAt: null },
  })
}

/**
 * Resolve credential references in node config.
 * Convention: config fields ending with `CredentialId` (e.g. `authCredentialId`)
 * are resolved and injected as the base field name (e.g. `_auth`).
 */
export async function resolveNodeCredentials(
  config: Record<string, unknown>,
  pipelineUserId: number,
): Promise<{ config: Record<string, unknown>; credentials: Record<string, Record<string, string>> }> {
  const credentials: Record<string, Record<string, string>> = {}
  const resolvedConfig = { ...config }

  for (const [key, value] of Object.entries(config)) {
    if (key.endsWith('CredentialId') && value && typeof value === 'number') {
      const baseName = key.replace(/CredentialId$/, '')
      try {
        const secretData = await resolveCredential(Number(value), pipelineUserId)
        credentials[baseName] = secretData

        if (secretData.token) {
          resolvedConfig[`_${baseName}Token`] = secretData.token
        }
        if (secretData.apiKey) {
          resolvedConfig[`_${baseName}ApiKey`] = secretData.apiKey
        }
      } catch (err) {
        throw new Error(
          `Ошибка загрузки учётных данных для "${baseName}": ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        )
      }
    }
  }

  return { config: resolvedConfig, credentials }
}

/** Test a credential by attempting to decrypt it. */
export async function testCredential(
  credentialId: number,
  userId: number,
): Promise<{ valid: boolean; error?: string; fields: string[] }> {
  try {
    const secretData = await resolveCredential(credentialId, userId)
    const fields = Object.keys(secretData)

    await prisma.pipelineCredential.update({
      where: { id: credentialId },
      data: { lastTestedAt: new Date(), lastTestStatus: 'valid' },
    })

    return { valid: true, fields }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Неизвестная ошибка'

    await prisma.pipelineCredential.update({
      where: { id: credentialId },
      data: { lastTestedAt: new Date(), lastTestStatus: `invalid: ${error.slice(0, 200)}` },
    }).catch(() => {})

    return { valid: false, error, fields: [] }
  }
}

/**
 * Get credential health summary for readiness checks.
 * Returns expiry warnings, revoked count, untested count.
 */
export async function getCredentialHealthSummary(userId: number): Promise<{
  total: number
  healthy: number
  expiringSoon: number
  expired: number
  revoked: number
  untested: number
  failedTest: number
}> {
  const credentials = await prisma.pipelineCredential.findMany({
    where: { userId },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastTestedAt: true,
      lastTestStatus: true,
    },
  })

  const now = new Date()
  const warningCutoff = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000)

  let healthy = 0
  let expiringSoon = 0
  let expired = 0
  let revoked = 0
  let untested = 0
  let failedTest = 0

  for (const cred of credentials) {
    if (cred.revokedAt) {
      revoked++
      continue
    }
    if (cred.expiresAt && cred.expiresAt < now) {
      expired++
      continue
    }
    if (cred.expiresAt && cred.expiresAt < warningCutoff) {
      expiringSoon++
      continue
    }
    if (!cred.lastTestedAt) {
      untested++
      continue
    }
    if (cred.lastTestStatus && cred.lastTestStatus.startsWith('invalid')) {
      failedTest++
      continue
    }
    healthy++
  }

  return {
    total: credentials.length,
    healthy,
    expiringSoon,
    expired,
    revoked,
    untested,
    failedTest,
  }
}

/**
 * Find which pipelines use a specific credential.
 * Scans graphData for CredentialId references.
 */
export async function findCredentialUsage(
  credentialId: number,
  userId: number,
): Promise<Array<{ pipelineId: number; pipelineName: string; nodeIds: string[] }>> {
  const pipelines = await prisma.pipeline.findMany({
    where: { userId },
    select: { id: true, name: true, graphData: true },
  })

  const usage: Array<{ pipelineId: number; pipelineName: string; nodeIds: string[] }> = []

  for (const pipeline of pipelines) {
    const graph = pipeline.graphData as { nodes?: Array<{ id: string; data?: { config?: Record<string, unknown> } }> }
    if (!Array.isArray(graph?.nodes)) continue

    const nodeIds: string[] = []
    for (const node of graph.nodes) {
      const config = node.data?.config ?? {}
      for (const [key, value] of Object.entries(config)) {
        if (key.endsWith('CredentialId') && Number(value) === credentialId) {
          nodeIds.push(node.id)
        }
      }
    }

    if (nodeIds.length > 0) {
      usage.push({ pipelineId: pipeline.id, pipelineName: pipeline.name, nodeIds })
    }
  }

  return usage
}
