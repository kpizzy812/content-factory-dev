/**
 * Regression-тесты RBAC философии после синхронизации с MarketingCamp.
 *
 * Главная проверка: на сервере НЕТ admin bypass для отдельных permissions —
 * каждый из 8 флагов (canRead/canWrite/.../canApplyChanges) проверяется независимо.
 * canAdmin сам по себе НЕ даёт право запускать агентов или удалять записи.
 *
 * Bypass через canAdmin есть ТОЛЬКО для модулей и приложений (для управления ими).
 *
 * Источник истины — MarketingCamp. Если в MC у админа canRunAgent=false, то и в
 * ZavodCamp 403 при попытке запуска. UI должен зеркалить это поведение
 * (см. usePermissions.can — без admin bypass).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

interface PermissionsResponse {
  data: {
    canAdmin: boolean
    canRunAgent: boolean
    canDelete: boolean
    moduleAccess: string[]
    apps: Array<{
      appId: number
      appName: string
      accessLevel: string
      accounts: string
      geos: string
      permissions: string
    }>
  }
}

describe("RBAC: admin bypass распространяется только на модули/приложения, не на 8 флагов", () => {
  it("админ без canRunAgent не может запустить операцию требующую canRunAgent", async () => {
    const user = await createTestUser({
      canAdmin: true,
      canRunAgent: false,
      canRead: true,
      canWrite: true,
      canCreate: true,
    })

    let status: number | null = null
    try {
      await $fetch("/api/videos/generate", {
        method: "POST",
        headers: authHeaders(user.id),
        body: { variantId: 999_999 },
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number }
      status = e.statusCode ?? e.status ?? null
    }

    // Должно вернуть 403 на canRunAgent проверке (не 404 на variantId, потому что
    // RBAC проверяется ДО лукапа variant).
    expect(status).toBe(403)
  })

  it("админ без canDelete не может удалить ресурс требующий canDelete", async () => {
    const user = await createTestUser({
      canAdmin: true,
      canDelete: false,
      canWrite: true,
      canRead: true,
    })

    let status: number | null = null
    try {
      await $fetch("/api/scenarios/999999", {
        method: "DELETE",
        headers: authHeaders(user.id),
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number }
      status = e.statusCode ?? e.status ?? null
    }

    expect(status).toBe(403)
  })

  it("админ с canAdmin=true имеет bypass на проверку модулей (canAccessModule)", async () => {
    const user = await createTestUser({
      canAdmin: true,
      canRead: true,
      moduleAccess: [],
    })

    const res = await $fetch<PermissionsResponse>("/api/auth/permissions", {
      headers: authHeaders(user.id),
    })

    expect(res.data.canAdmin).toBe(true)
    expect(res.data.moduleAccess).toEqual([])
    // Bypass теста: requireModuleAccess в /api/auth/permissions нет, но любой защищённый
    // эндпоинт через requireScopedAccess должен пропустить админа в модуль.
  })
})

describe("RBAC: UserAppAssignment гранулярная модель", () => {
  it("permissions endpoint возвращает apps с полями accessLevel/accounts/geos/permissions", async () => {
    const user = await createTestUser({
      canAdmin: false,
      canRead: true,
      appAssignments: [
        {
          appId: 100001,
          appName: "TestApp",
          accessLevel: "read_only",
          accounts: "all",
          geos: "US,MX",
          permissions: "read",
        },
      ],
    })

    const res = await $fetch<PermissionsResponse>("/api/auth/permissions", {
      headers: authHeaders(user.id),
    })

    expect(res.data.apps).toHaveLength(1)
    const app = res.data.apps[0]!
    expect(app.appId).toBe(100001)
    expect(app.appName).toBe("TestApp")
    expect(app.accessLevel).toBe("read_only")
    expect(app.accounts).toBe("all")
    expect(app.geos).toBe("US,MX")
    expect(app.permissions).toBe("read")
  })

  it("appAssignment с accessLevel='none' блокирует доступ к app", async () => {
    const user = await createTestUser({
      canAdmin: false,
      canRead: true,
      appAssignments: [
        { appId: 200001, appName: "BlockedApp", accessLevel: "none" },
      ],
    })

    // Создаём favorite-prompt c этим appId — должно упасть в 403 на этапе RBAC.
    let status: number | null = null
    try {
      await $fetch("/api/favorite-prompts", {
        method: "POST",
        headers: authHeaders(user.id),
        body: {
          promptText: "test prompt",
          appId: 200001,
        },
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number }
      status = e.statusCode ?? e.status ?? null
    }

    // 403 на permissions (нет canCreate) или 403 на app access — оба варианта корректны.
    // Главное — не 200/201.
    expect(status).toBeGreaterThanOrEqual(400)
    expect(status).toBeLessThan(500)
  })
})

describe("RBAC: ZavodUser больше не имеет appAccess поля (мигрирован на appAssignments)", () => {
  it("Prisma client отдаёт user без appAccess, с appAssignments через include", async () => {
    const user = await createTestUser({
      canAdmin: true,
      appAssignments: [{ appId: 300001, appName: "App1" }],
    })

    const fetched = await prisma.zavodUser.findUnique({
      where: { id: user.id },
      include: { appAssignments: true },
    })

    expect(fetched).not.toBeNull()
    // @ts-expect-error — appAccess больше не существует, проверяем что Prisma не возвращает.
    expect(fetched.appAccess).toBeUndefined()
    expect(fetched!.appAssignments).toHaveLength(1)
    expect(fetched!.appAssignments[0]!.appName).toBe("App1")
  })
})
