/**
 * DuoPlus device-контекст для PostingJob-карточки.
 *
 * Достаёт из привязанного DeviceProfile минимальный блок { deviceProfileId,
 * deviceName, deviceImageId, deviceStatus }, чтобы оператор на странице постинга
 * видел, через какое устройство идёт публикация и его last-known статус.
 *
 * ВАЖНО: постинг резолвит устройство по `SocialAccount.deviceProfileId` (FK,
 * см. resolveDeviceContext в server/automation/poster-runner.ts) — это ОТДЕЛЬНАЯ
 * связь от back-relation `socialAccount.deviceProfile` (DeviceProfile.socialAccountId
 * denorm). Чтобы карточка показывала именно то устройство, через которое реально
 * идёт постинг, резолвим по `deviceProfileId` пачкой через
 * `loadDeviceContextMap`.
 *
 * Источник статуса — `DeviceProfile.config.duoplus.deviceStatus` (наполняется
 * device-sync P7, last-known — не запрашивается на каждый GET из-за QPS=1 на
 * DuoPlus API).
 */
import type { PostingJobDeviceSummary, PostingEngineMeta } from "../../../shared/types/posting-job"

/** Минимальный shape привязанного device-профиля для построения summary. */
export interface DeviceContextRow {
  id: string
  name: string
  indigoId: string | null
  config: unknown
}

/** Извлекает last-known deviceStatus из config.duoplus (см. dto.extractDuoplusInfo). */
function extractDeviceStatus(config: unknown): number | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null
  const duoplus = (config as Record<string, unknown>).duoplus
  if (!duoplus || typeof duoplus !== "object" || Array.isArray(duoplus)) return null
  const status = (duoplus as Record<string, unknown>).deviceStatus
  return typeof status === "number" ? status : null
}

/** Строит device-summary из строки профиля. */
function toDeviceSummary(row: DeviceContextRow): PostingJobDeviceSummary {
  return {
    deviceProfileId: row.id,
    deviceName: row.name,
    deviceImageId: row.indigoId ?? null,
    deviceStatus: extractDeviceStatus(row.config),
  }
}

/**
 * Грузит device-профили по списку id (из `SocialAccount.deviceProfileId` джоб)
 * одним запросом и возвращает Map id → summary. Дедуп id внутри. Пустой список →
 * пустая Map (без запроса).
 */
export async function loadDeviceContextMap(
  deviceProfileIds: Array<string | null | undefined>,
): Promise<Map<string, PostingJobDeviceSummary>> {
  const ids = Array.from(
    new Set(deviceProfileIds.filter((id): id is string => !!id)),
  )
  const map = new Map<string, PostingJobDeviceSummary>()
  if (ids.length === 0) return map

  const rows = await prisma.deviceProfile.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, indigoId: true, config: true },
  })
  for (const row of rows) {
    map.set(row.id, toDeviceSummary(row))
  }
  return map
}

/**
 * Состояние DuoPlus-движка автоматизации (гейт DUOPLUS_ENGINE_ENABLED). Зеркалит
 * isDuoplusEngineEnabled() из server/automation/poster-runner.ts — читается из
 * process.env на сервере и отдаётся клиенту для инфо-плашки freeze/active.
 */
export function getPostingEngineMeta(): PostingEngineMeta {
  // Терпим к формату значения env (Saturn хранит "ON"): true/1/on/yes/enabled.
  const v = process.env.DUOPLUS_ENGINE_ENABLED?.trim().toLowerCase()
  const enabled = v === "true" || v === "1" || v === "on" || v === "yes" || v === "enabled"
  return {
    duoplusEngineEnabled: enabled,
  }
}
