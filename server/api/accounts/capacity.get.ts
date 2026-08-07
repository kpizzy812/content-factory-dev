/**
 * GET /api/accounts/capacity
 * Свободная ёмкость публикаций и прогноз восстановления лимита на сутки.
 *
 * Ёмкость — из замера площадки, прогноз — из нашей истории публикаций.
 * Разные источники и разная достоверность, поэтому и отдаются они порознь.
 */
import { computePublishingCapacity } from '../../utils/accounts/publishing-capacity'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'social-upload' })

  const query = getQuery(event)
  const appIdRaw = Number(query.appId)
  const platformRaw = String(query.platform ?? '').trim()
  const platform = ['tiktok', 'instagram', 'youtube'].includes(platformRaw) ? platformRaw : null

  return {
    data: await computePublishingCapacity({
      appId: Number.isInteger(appIdRaw) && appIdRaw > 0 ? appIdRaw : null,
      platform,
    }),
  }
})
