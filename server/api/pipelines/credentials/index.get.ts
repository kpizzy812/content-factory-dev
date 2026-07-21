/**
 * List user's pipeline credentials (masked, no secrets exposed).
 * Includes health status and optional usage info.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const credentials = await prisma.pipelineCredential.findMany({
    where: { userId: user.id },
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
    orderBy: { createdAt: 'desc' },
  })

  // Compute health status per credential
  const now = new Date()
  const warningCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const enriched = credentials.map((cred) => {
    let healthStatus: 'healthy' | 'expiring_soon' | 'expired' | 'revoked' | 'untested' | 'failed_test' = 'healthy'

    if (cred.revokedAt) healthStatus = 'revoked'
    else if (cred.expiresAt && cred.expiresAt < now) healthStatus = 'expired'
    else if (cred.expiresAt && cred.expiresAt < warningCutoff) healthStatus = 'expiring_soon'
    else if (!cred.lastTestedAt) healthStatus = 'untested'
    else if (cred.lastTestStatus?.startsWith('invalid')) healthStatus = 'failed_test'

    return { ...cred, healthStatus }
  })

  return { data: enriched }
})
