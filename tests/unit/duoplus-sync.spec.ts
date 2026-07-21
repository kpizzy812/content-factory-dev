/**
 * Unit-тесты device-sync DuoPlus → DeviceProfile (Этап 3, P7).
 *
 * Проверяют `syncDeviceProfilesFromRemote`:
 *   - импорт устройств из mock-аккаунта DuoPlus в DeviceProfile (по indigoId=image_id);
 *   - маппинг полей (name/os/platformType/area/status в config.duoplus);
 *   - идемпотентность: повторный sync обновляет, не дублирует;
 *   - local-only профили (indigoId=null) НЕ участвуют и не трогаются;
 *   - synced-профиль, исчезнувший из облака → deleted_remote.
 *
 * Device-flow идёт против реального in-process mock-сервера DuoPlus (как
 * duoplus-fsm-integration.spec). Prisma замокана in-memory store'ом.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface ProfileRow {
  id: string
  indigoId: string | null
  indigoFolderId: string | null
  name: string
  platformType: string
  os: string | null
  proxyId: string | null
  config: unknown
  syncStatus: string
  lastSyncedAt: Date | null
  lastSyncError: string | null
  createdById: number | null
}

// In-memory prisma store, доступен тестам для ассертов через хелперы ниже.
const store = vi.hoisted(() => {
  const profiles: Record<string, unknown>[] = []
  const proxies: Record<string, unknown>[] = []
  let seq = 0
  return {
    profiles,
    proxies,
    nextId: () => `dp-${(seq += 1)}`,
    reset() {
      profiles.length = 0
      proxies.length = 0
      seq = 0
    },
  }
})

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const val = row[key]
    if (cond !== null && typeof cond === "object") {
      const c = cond as Record<string, unknown>
      if ("not" in c) {
        if (c.not === null) {
          if (val === null || val === undefined) return false
        } else if (val === c.not) {
          return false
        }
      }
      if ("notIn" in c && Array.isArray(c.notIn) && c.notIn.includes(val)) return false
      if ("in" in c && Array.isArray(c.in) && !c.in.includes(val)) return false
    } else if (val !== cond) {
      return false
    }
  }
  return true
}

vi.mock("../../server/utils/prisma", () => ({
  prisma: {
    deviceProfile: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return store.profiles.find((p) => matchWhere(p, where)) ?? null
      }),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        return store.profiles.filter((p) => (where ? matchWhere(p, where) : true))
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: store.nextId(), ...data }
        store.profiles.push(row)
        return row
      }),
      update: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const row = store.profiles.find((p) => matchWhere(p, where))
          if (!row) throw new Error("update: row not found")
          Object.assign(row, data)
          return row
        },
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = store.profiles.filter((p) => matchWhere(p, where))
          for (const r of rows) Object.assign(r, data)
          return { count: rows.length }
        },
      ),
    },
    proxy: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return store.proxies.find((p) => matchWhere(p, where)) ?? null
      }),
    },
  },
}))

import {
  createDuoplusMockServer,
  type DuoplusMockHandle,
  type MockDuoplusDevice,
} from "../../server/__mocks__/duoplus-server"
import { resetDuoplusClient } from "../../server/utils/posting-provider/duoplus-client"
import {
  refreshDeviceStatusFromRemote,
  syncDeviceProfilesFromRemote,
} from "../../server/utils/posting-provider/sync"

const API_KEY = "test-key-from-env"

function seedDevice(over: Partial<MockDuoplusDevice> = {}): MockDuoplusDevice {
  return {
    id: "M2Hxh",
    name: "US-Device-1",
    status: 2,
    os: "Android 15",
    size: "1080x1920",
    created_at: "2026-06-12T00:00:00Z",
    expired_at: "2026-07-12T00:00:00Z",
    ip: "98.98.125.9",
    area: "US",
    remark: "",
    adb: "",
    adb_password: "",
    group: "default",
    ...over,
  }
}

function getProfile(indigoId: string): ProfileRow | undefined {
  return store.profiles.find((p) => p.indigoId === indigoId) as ProfileRow | undefined
}

describe("syncDeviceProfilesFromRemote (DuoPlus → DeviceProfile)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    store.reset()
    mock = await createDuoplusMockServer()
    process.env.DUOPLUS_MOCK_MODE = "true"
    process.env.DUOPLUS_MOCK_URL = mock.baseUrl
    process.env.DUOPLUS_API_KEY = API_KEY
    resetDuoplusClient()
  })

  afterEach(async () => {
    await mock.close()
    resetDuoplusClient()
    delete process.env.DUOPLUS_MOCK_MODE
    delete process.env.DUOPLUS_MOCK_URL
    delete process.env.DUOPLUS_API_KEY
  })

  it("импортирует устройства из mock-аккаунта в DeviceProfile с верным маппингом", async () => {
    const result = await syncDeviceProfilesFromRemote(7)

    // Default seed = 2 US-устройства Android 15.
    expect(result.total).toBe(2)
    expect(result.imported).toBe(2)
    expect(result.updated).toBe(0)
    expect(result.errors).toBe(0)
    expect(store.profiles).toHaveLength(2)

    const dev1 = getProfile("M2Hxh")!
    expect(dev1).toBeDefined()
    expect(dev1.name).toBe("US-Device-1")
    expect(dev1.os).toBe("Android 15")
    expect(dev1.platformType).toBe("mobile_android")
    expect(dev1.syncStatus).toBe("synced")
    expect(dev1.createdById).toBe(7)

    // Регион + статус устройства в config.duoplus (НЕ в syncStatus).
    const cfg = dev1.config as { duoplus: { area: string; deviceStatus: number; raw: unknown } }
    expect(cfg.duoplus.area).toBe("US")
    expect(cfg.duoplus.deviceStatus).toBe(2) // OFF
    expect(cfg.duoplus.raw).toBeDefined()
  })

  it("повторный sync обновляет, не дублирует (идемпотентность по image_id)", async () => {
    await syncDeviceProfilesFromRemote(7)
    expect(store.profiles).toHaveLength(2)

    const result2 = await syncDeviceProfilesFromRemote(7)
    expect(result2.imported).toBe(0)
    expect(result2.updated).toBe(2)
    expect(store.profiles).toHaveLength(2) // без дублей
  })

  it("обновляет config.duoplus.deviceStatus при смене статуса устройства в облаке", async () => {
    await mock.close()
    mock = await createDuoplusMockServer({
      seedDevices: [seedDevice({ id: "M2Hxh", status: 2 })],
    })
    process.env.DUOPLUS_MOCK_URL = mock.baseUrl
    resetDuoplusClient()

    await syncDeviceProfilesFromRemote(7)
    let cfg = getProfile("M2Hxh")!.config as { duoplus: { deviceStatus: number } }
    expect(cfg.duoplus.deviceStatus).toBe(2)

    // Устройство включается в облаке → статус ON (1), появляется adb.
    const dev = mock.devices.get("M2Hxh")!
    dev.status = 1
    dev.adb = "98.98.125.9:27777"

    await syncDeviceProfilesFromRemote(7)
    cfg = getProfile("M2Hxh")!.config as { duoplus: { deviceStatus: number; adb: string } }
    expect(cfg.duoplus.deviceStatus).toBe(1)
    expect(cfg.duoplus.adb).toBe("98.98.125.9:27777")
  })

  it("local-only профиль (indigoId=null) не участвует в импорте и не трогается", async () => {
    store.profiles.push({
      id: "local-1",
      indigoId: null,
      indigoFolderId: null,
      name: "Локальный профиль",
      platformType: "desktop",
      os: null,
      proxyId: null,
      config: { fingerprint: { canvas: "noise" } },
      syncStatus: "local_only",
      lastSyncedAt: null,
      lastSyncError: null,
      createdById: 7,
    })

    const result = await syncDeviceProfilesFromRemote(7)
    expect(result.imported).toBe(2)

    const local = store.profiles.find((p) => p.id === "local-1") as ProfileRow
    // local-only нетронут: статус и config сохранены.
    expect(local.syncStatus).toBe("local_only")
    expect((local.config as { fingerprint: { canvas: string } }).fingerprint.canvas).toBe("noise")
  })

  it("synced-профиль, исчезнувший из облака → deleted_remote", async () => {
    await syncDeviceProfilesFromRemote(7)
    expect(getProfile("M2Hxh")!.syncStatus).toBe("synced")

    // Облако отдаёт только одно устройство — второе исчезло.
    await mock.close()
    mock = await createDuoplusMockServer({ seedDevices: [seedDevice({ id: "M2Hxh" })] })
    process.env.DUOPLUS_MOCK_URL = mock.baseUrl
    resetDuoplusClient()

    const result = await syncDeviceProfilesFromRemote(7)
    expect(result.updated).toBe(1) // M2Hxh обновлён
    expect(getProfile("M2Hxh")!.syncStatus).toBe("synced")
    expect(getProfile("4kwGy")!.syncStatus).toBe("deleted_remote")
  })

  it("линкует локальный Proxy по host (device.ip), если он есть", async () => {
    store.proxies.push({ id: "proxy-1", host: "98.98.125.9", port: 8080 })

    await syncDeviceProfilesFromRemote(7)
    const dev1 = getProfile("M2Hxh")!
    expect(dev1.proxyId).toBe("proxy-1") // ip=98.98.125.9 совпал

    const dev2 = getProfile("4kwGy")!
    expect(dev2.proxyId).toBeNull() // ip=76.76.21.5 нет в локальных Proxy
  })

  it("refreshDeviceStatusFromRemote точечно обновляет deviceStatus профиля из облака", async () => {
    await syncDeviceProfilesFromRemote(7)
    const profile = getProfile("M2Hxh")!
    expect((profile.config as { duoplus: { deviceStatus: number } }).duoplus.deviceStatus).toBe(2)

    // В облаке устройство включилось → ON(1). Точечный refresh (как после powerOff/On).
    mock.devices.get("M2Hxh")!.status = 1
    const status = await refreshDeviceStatusFromRemote(profile.id as string, "M2Hxh")
    expect(status).toBe(1)
    expect(
      (getProfile("M2Hxh")!.config as { duoplus: { deviceStatus: number } }).duoplus.deviceStatus,
    ).toBe(1)
  })

  it("refreshDeviceStatusFromRemote → null, если устройства нет в облаке", async () => {
    await syncDeviceProfilesFromRemote(7)
    const profile = getProfile("M2Hxh")!
    expect(await refreshDeviceStatusFromRemote(profile.id as string, "GHOST")).toBeNull()
  })
})
