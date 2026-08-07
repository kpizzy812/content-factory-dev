/**
 * GET /api/analytics/chain/:uploadId
 * Разбор публикации: цепочка происхождения, касания и события атрибуции.
 */
import { computePublicationChain } from '../../../utils/analytics/publication-chain'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'analytics' })

  const uploadId = Number(getRouterParam(event, 'uploadId'))
  if (!Number.isInteger(uploadId) || uploadId <= 0) {
    throw createError({ statusCode: 400, message: 'Неверный идентификатор публикации' })
  }

  const data = await computePublicationChain(uploadId)
  if (!data) {
    throw createError({ statusCode: 404, message: 'Публикация не найдена' })
  }

  return { data }
})
