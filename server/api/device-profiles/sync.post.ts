/**
 * POST /api/device-profiles/sync
 *
 * Этап 3, P7: реальная device-sync поверх DuoPlus REST API. Импортирует облачные
 * cloud phones (`cloudPhone/list`) в локальные DeviceProfile (upsert по indigoId =
 * image_id DuoPlus). Односторонний импорт (remote = источник истины). RBAC-гейт
 * `canRunAgent` / модуль `social-upload`. Возвращает DeviceSyncResult-статистику.
 */
import { syncDeviceProfilesFromRemote } from "~~/server/utils/posting-provider/sync"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "social-upload",
  })

  const result = await syncDeviceProfilesFromRemote(user.id)
  return { data: result }
})
