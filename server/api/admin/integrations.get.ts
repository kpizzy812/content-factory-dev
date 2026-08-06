/**
 * GET /api/admin/integrations — состояние внешних сервисов.
 *
 * Отвечает на «работает ли оно», а не «какой там ключ»: ключи задаются
 * окружением и в интерфейс не выводятся ни целиком, ни маской.
 *
 * Отдельно от `/api/admin/system-health`: здесь ходят наружу, и запрос идёт
 * секунды, а состояние воркеров нужно быстро и часто.
 */

import { checkIntegrations } from '~~/server/utils/integrations/health'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'canAdmin')

  return { data: await checkIntegrations() }
})
