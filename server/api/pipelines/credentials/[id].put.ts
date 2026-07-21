/**
 * Update a pipeline credential (name, description, secret data).
 * If secretData is provided — performs rotation (re-encrypts, resets test status).
 */
import { invalidateDriveTokenCache } from "~~/server/utils/google-drive/credential"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID' })
  }

  const cred = await prisma.pipelineCredential.findFirst({
    where: { id, userId: user.id },
  })

  if (!cred) {
    throw createError({ statusCode: 404, message: 'Учётные данные не найдены' })
  }

  const body = await readBody<{
    name?: string
    description?: string
    secretData?: Record<string, string>
    expiresAt?: string | null
  }>(event)

  // If secretData provided — use rotation flow
  if (body?.secretData && typeof body.secretData === 'object' && Object.keys(body.secretData).length > 0) {
    await rotateCredential(id, user.id, body.secretData)
  }

  // Update metadata fields
  const updateData: Record<string, unknown> = {}

  if (body?.name && typeof body.name === 'string') {
    updateData.name = body.name.trim()
  }

  if (body?.description !== undefined) {
    updateData.description = body.description?.trim() || null
  }

  if (body?.expiresAt !== undefined) {
    updateData.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.pipelineCredential.update({
      where: { id },
      data: updateData,
    })
  }

  // Сброс token cache — на случай если это Drive-credential
  invalidateDriveTokenCache(id)

  // Return updated credential
  const updated = await prisma.pipelineCredential.findUnique({
    where: { id },
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

  return { data: updated }
})
