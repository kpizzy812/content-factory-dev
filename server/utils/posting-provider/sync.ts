/**
 * Синхронизация device-профилей: DuoPlus cloud phones → наша БД (DeviceProfile).
 *
 * Этап 3, фаза P7. Заменяет no-op R3-стаб реальной импорт-синхронизацией поверх
 * DuoPlus REST API (`cloudPhone/list`).
 *
 * Модель DuoPlus: облачные Android-устройства создаются на стороне DuoPlus
 * (мы их НЕ создаём из ZavodCamp), поэтому sync — ОДНОСТОРОННИЙ импорт:
 * remote = источник истины для device-полей, мы только зеркалим парк в локальную БД.
 *
 * Маппинг DuoPlus device → DeviceProfile:
 *   device.id        → indigoId        (image_id DuoPlus, @unique ключ upsert)
 *   device.name      → name            (только при импорте; локальные правки не
 *                                        перезатираем при повторном sync)
 *   device.os        → os              ("Android 15")
 *   —                → platformType    = "mobile_android" (DuoPlus = Android phones)
 *   device.area      → config.duoplus.area (регион, напр. "US")
 *   device.status    → config.duoplus.deviceStatus (последний известный статус
 *                       устройства 0/1/2/3/4/10/11/12 для UI — НЕ путать с
 *                       syncStatus нашей БД-синхронизации)
 *   device.adb       → config.duoplus.adb (адрес, пуст пока status != 1)
 *   полный device    → config.duoplus.raw (opaque снапшот last-known)
 *   syncStatus       = "synced" (пришёл из облака)
 *
 * Прокси DuoPlus уже привязаны на стороне устройства (1:1:1 device→proxy
 * настраивается в DuoPlus). Мы пытаемся слинковать `proxyId`, если в локальной
 * БД есть Proxy с совпадающим host (device.ip) — иначе оставляем как есть.
 *
 * Local-only профили (созданные в ZavodCamp без облачного push) НЕ трогаем:
 * у них indigoId=null, они не участвуют в импорте. Профили, ранее синканные из
 * облака (indigoId != null), которых больше нет в списке DuoPlus → помечаем
 * `deleted_remote` (не удаляем — оператор разбирается). archived пропускаем.
 */

import { prisma } from "../prisma"
import type { DeviceSyncResult } from "../../../shared/types/device-profile"
import { getDuoplusClient } from "./duoplus-client"
import type { DuoplusDevice } from "./duoplus-types"

/** Снапшот DuoPlus-полей внутри DeviceProfile.config.duoplus. */
interface DuoplusConfigSnapshot {
  area: string | null
  deviceStatus: number
  adb: string
  os: string
  size: string
  /** Полный last-known device-объект (opaque). */
  raw: DuoplusDevice
}

/**
 * Строит config-объект для DeviceProfile, сохраняя ранее записанные поля config
 * (fingerprint/devicePresetId и пр. от local-create) и накладывая свежий
 * DuoPlus-снапшот в подключ `duoplus`.
 */
export function buildConfig(
  existingConfig: unknown,
  device: DuoplusDevice,
): Record<string, unknown> {
  const base =
    existingConfig && typeof existingConfig === "object" && !Array.isArray(existingConfig)
      ? { ...(existingConfig as Record<string, unknown>) }
      : {}
  const snapshot: DuoplusConfigSnapshot = {
    area: device.area ?? null,
    deviceStatus: device.status,
    adb: device.adb ?? "",
    os: device.os,
    size: device.size,
    raw: device,
  }
  base.duoplus = snapshot
  return base
}

/**
 * Слинковать локальный Proxy по host (device.ip). DuoPlus прокси настроены на
 * стороне устройства; матч по host — best-effort, чтобы UI показал привязку.
 * Не создаём новые Proxy (без credentials они мертвы). null если нет совпадения.
 */
async function resolveLocalProxyId(device: DuoplusDevice): Promise<string | null> {
  const host = typeof device.ip === "string" ? device.ip.trim() : ""
  if (!host) return null
  const local = await prisma.proxy.findFirst({
    where: { host },
    select: { id: true },
  })
  return local?.id ?? null
}

export async function syncDeviceProfilesFromRemote(
  createdById: number | null = null,
): Promise<DeviceSyncResult> {
  const client = getDuoplusClient()

  const remoteList: DuoplusDevice[] = await client.listCloudPhones()

  let imported = 0
  let updated = 0
  let conflicted = 0
  let skipped = 0
  let errors = 0
  const remoteIds = new Set<string>()

  for (const device of remoteList) {
    if (!device.id) {
      errors += 1
      continue
    }
    remoteIds.add(device.id)

    try {
      const existing = await prisma.deviceProfile.findUnique({
        where: { indigoId: device.id },
      })

      const deviceName = device.name?.trim() || `duoplus-${device.id}`

      if (!existing) {
        const resolvedProxyId = await resolveLocalProxyId(device)
        await prisma.deviceProfile.create({
          data: {
            indigoId: device.id,
            indigoFolderId: null,
            name: deviceName,
            platformType: "mobile_android",
            os: device.os || null,
            proxyId: resolvedProxyId,
            config: buildConfig(null, device) as object,
            syncStatus: "synced",
            lastSyncedAt: new Date(),
            lastSyncError: null,
            createdById,
          },
        })
        imported += 1
      } else {
        // archived (soft-deleted оператором) — не трогаем, остаётся скрытым.
        if (existing.syncStatus === "archived") {
          skipped += 1
          continue
        }
        // proxy backfill: если у existing нет proxyId — пытаемся подтянуть.
        // НЕ перезатираем существующий proxyId (оператор мог явно поменять).
        const resolvedProxyId = existing.proxyId ?? (await resolveLocalProxyId(device))
        await prisma.deviceProfile.update({
          where: { id: existing.id },
          data: {
            // name НЕ перезаписываем (оператор мог переименовать локально), но
            // если он пустой/служебный — обновим. os только если пуст локально.
            os: existing.os ?? (device.os || null),
            proxyId: resolvedProxyId,
            config: buildConfig(existing.config, device) as object,
            syncStatus: "synced",
            lastSyncedAt: new Date(),
            lastSyncError: null,
          },
        })
        updated += 1
      }
    } catch (err) {
      errors += 1
      const message = err instanceof Error ? err.message : String(err)
      await prisma.deviceProfile.updateMany({
        where: { indigoId: device.id },
        data: { syncStatus: "error", lastSyncError: message },
      })
    }
  }

  // Профили, ранее синканные из облака (indigoId != null), которых больше нет в
  // списке DuoPlus → помечаем deleted_remote. archived/deleted_remote пропускаем,
  // local_only (indigoId=null) сюда не попадают (фильтр indigoId not null).
  const localWithImageId = await prisma.deviceProfile.findMany({
    where: {
      indigoId: { not: null },
      syncStatus: { notIn: ["deleted_remote", "archived"] },
    },
    select: { id: true, indigoId: true },
  })
  for (const row of localWithImageId) {
    if (row.indigoId && !remoteIds.has(row.indigoId)) {
      await prisma.deviceProfile.update({
        where: { id: row.id },
        data: { syncStatus: "deleted_remote", lastSyncedAt: new Date() },
      })
    }
  }

  return {
    imported,
    updated,
    conflicted,
    skipped,
    errors,
    total: remoteList.length,
  }
}

/**
 * Точечно обновляет config.duoplus.deviceStatus одного профиля из DuoPlus list
 * (после powerOn/powerOff — чтобы UI-бейдж сразу показал реальный статус, не
 * дожидаясь массового sync). Возвращает актуальный device.status (0/1/2/10/11/…)
 * или null, если устройства нет в списке DuoPlus.
 */
export async function refreshDeviceStatusFromRemote(
  profileId: string,
  imageId: string,
): Promise<number | null> {
  const client = getDuoplusClient()
  const list = await client.listCloudPhones()
  const dev = list.find((d) => d.id === imageId)
  if (!dev) return null
  const existing = await prisma.deviceProfile.findUnique({
    where: { id: profileId },
    select: { config: true },
  })
  await prisma.deviceProfile.update({
    where: { id: profileId },
    data: {
      config: buildConfig(existing?.config, dev) as object,
      lastSyncedAt: new Date(),
    },
  })
  return dev.status
}
