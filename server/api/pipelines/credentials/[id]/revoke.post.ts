/**
 * Soft-revoke a credential — blocks usage without deletion.
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

  await revokeCredential(id, user.id)
  invalidateDriveTokenCache(id)

  return { data: { revoked: true } }
})
