/**
 * Delete a pipeline credential.
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

  await prisma.pipelineCredential.delete({ where: { id } })
  invalidateDriveTokenCache(id)

  return { data: { deleted: true } }
})
