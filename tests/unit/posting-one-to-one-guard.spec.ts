/**
 * Unit-тесты assertOneToOneForBrowserAutomation (PR4 — 1:1:1 enforcement).
 *
 * Идеология: один прокси ↔ один Indigo-профиль ↔ один browser_automation-аккаунт.
 * api-аккаунты НЕ ограничены (легитимный шеринг прокси — не ломаем).
 *
 * Покрытие:
 *  - общий прокси у двух browser_automation → 409 proxy_shared_browser_automation
 *  - общий indigo-профиль у двух browser_automation → 409 indigo_profile_shared
 *  - api-аккаунт шарит прокси → OK (guard ищет ТОЛЬКО browser_automation)
 *  - разные прокси/профили → OK
 *  - tx-вариант (передан кастомный клиент) — используется именно он
 *  - accountId исключается из поиска (сам себя не считает занятым)
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

// createError автоимпортится в Nuxt/Nitro; в vitest его нет — минимальный stub.
;(globalThis as Record<string, unknown>).createError = (opts: {
  statusCode?: number
  statusMessage?: string
  message?: string
  [key: string]: unknown
}): Error => {
  const err = new Error(opts.message ?? "createError")
  return Object.assign(err, opts)
}

// Дефолтный prisma-singleton мокаем, чтобы guard без tx обращался к нему.
// vi.hoisted нужен, т.к. фабрика vi.mock поднимается выше объявлений.
const { defaultFindFirst } = vi.hoisted(() => ({ defaultFindFirst: vi.fn() }))
vi.mock("../../server/utils/prisma", () => ({
  prisma: {
    socialAccount: {
      findFirst: defaultFindFirst,
    },
  },
}))

import { assertOneToOneForBrowserAutomation } from "../../server/utils/accounts/one-to-one-guard"

interface OccupantRow {
  id: number
  displayName: string
  platform: string
}

/** Фейковый Prisma-клиент (или tx), который отдаёт occupant по where-условию. */
function makeClient(
  byProxy: OccupantRow | null,
  byIndigo: OccupantRow | null,
): { socialAccount: { findFirst: ReturnType<typeof vi.fn> } } {
  return {
    socialAccount: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        if ("proxyId" in args.where) return byProxy
        if ("deviceProfileId" in args.where) return byIndigo
        return null
      }),
    },
  }
}

describe("assertOneToOneForBrowserAutomation (1:1:1)", () => {
  beforeEach(() => {
    defaultFindFirst.mockReset()
    defaultFindFirst.mockResolvedValue(null)
  })

  it("общий прокси у двух browser_automation → 409 proxy_shared_browser_automation", async () => {
    const client = makeClient(
      { id: 7, displayName: "acc-seven", platform: "instagram" },
      null,
    )
    await expect(
      assertOneToOneForBrowserAutomation(1, { proxyId: "proxy-A" }, client as never),
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: "proxy_shared_browser_automation",
    })
  })

  it("общий indigo-профиль у двух browser_automation → 409 indigo_profile_shared", async () => {
    const client = makeClient(null, {
      id: 9,
      displayName: "acc-nine",
      platform: "instagram",
    })
    await expect(
      assertOneToOneForBrowserAutomation(
        1,
        { deviceProfileId: "indigo-Z" },
        client as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: "indigo_profile_shared",
    })
  })

  it("api-аккаунт шарит прокси → OK (guard ищет только browser_automation)", async () => {
    // Запрос guard'а жёстко фильтрует postingMethod='browser_automation'.
    // Даже если прокси используется api-аккаунтами, findFirst по BA вернёт null.
    const findFirst = vi.fn(async (args: { where: Record<string, unknown> }) => {
      expect(args.where.postingMethod).toBe("browser_automation")
      return null // среди browser_automation никого нет
    })
    const client = { socialAccount: { findFirst } }
    await expect(
      assertOneToOneForBrowserAutomation(1, { proxyId: "shared-proxy" }, client as never),
    ).resolves.toBeUndefined()
    expect(findFirst).toHaveBeenCalled()
  })

  it("разные прокси/профили → OK (нет occupant)", async () => {
    const client = makeClient(null, null)
    await expect(
      assertOneToOneForBrowserAutomation(
        1,
        { proxyId: "proxy-unique", deviceProfileId: "indigo-unique" },
        client as never,
      ),
    ).resolves.toBeUndefined()
  })

  it("tx-вариант: использует переданный клиент, не дефолтный prisma", async () => {
    const client = makeClient(null, null)
    await assertOneToOneForBrowserAutomation(
      1,
      { proxyId: "proxy-tx" },
      client as never,
    )
    expect(client.socialAccount.findFirst).toHaveBeenCalledTimes(1)
    // дефолтный singleton не должен трогаться при переданном tx-клиенте
    expect(defaultFindFirst).not.toHaveBeenCalled()
  })

  it("accountId>0 исключает сам аккаунт из поиска (id != accountId)", async () => {
    const client = makeClient(null, null)
    await assertOneToOneForBrowserAutomation(42, { proxyId: "p" }, client as never)
    const callArg = client.socialAccount.findFirst.mock.calls[0][0] as {
      where: { id?: { not: number } }
    }
    expect(callArg.where.id).toEqual({ not: 42 })
  })

  it("accountId<=0 (новый аккаунт) не добавляет исключение id", async () => {
    const client = makeClient(null, null)
    await assertOneToOneForBrowserAutomation(0, { proxyId: "p" }, client as never)
    const callArg = client.socialAccount.findFirst.mock.calls[0][0] as {
      where: { id?: unknown }
    }
    expect(callArg.where.id).toBeUndefined()
  })

  it("пустой target (нет proxyId/deviceProfileId) → OK, не дёргает БД", async () => {
    const client = makeClient(null, null)
    await expect(
      assertOneToOneForBrowserAutomation(1, {}, client as never),
    ).resolves.toBeUndefined()
    expect(client.socialAccount.findFirst).not.toHaveBeenCalled()
  })

  it("без tx-клиента использует дефолтный prisma-singleton", async () => {
    defaultFindFirst.mockResolvedValue(null)
    await expect(
      assertOneToOneForBrowserAutomation(1, { proxyId: "p" }),
    ).resolves.toBeUndefined()
    expect(defaultFindFirst).toHaveBeenCalledTimes(1)
  })
})
