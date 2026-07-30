/**
 * Integration-тесты GET /api/device-profiles (list endpoint).
 *
 * Покрытие:
 *   - P1-2 fix: socialAccountId + search фильтр combined — оба условия должны
 *     применяться, не перезаписываться.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import {
  createTestApp,
  createTestProxy,
  createTestSocialAccount,
} from "../helpers/factories"
import { prisma } from "../../server/utils/prisma"

// Зона device-автоматизации выключена по умолчанию — этот suite её проверяет, поэтому включает явно.
await setup({ dev: true, server: true, browser: false, env: { ...nuxtTestEnv, LEGACY_DEVICE_AUTOMATION_ENABLED: "true" } })

interface IndigoProfileDtoLike {
  id: string
  name: string
  socialAccountId: number | null
  accounts: Array<{ id: number }>
}

describe("GET /api/device-profiles — search + socialAccountId combined", () => {
  it("оба фильтра применяются: только профили с привязкой к accountX И name~term", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const proxy = await createTestProxy({ expectedCountry: "US", createdById: user.id })
    const accountX = await createTestSocialAccount({ appId: app.id, displayName: "X" })
    const accountY = await createTestSocialAccount({ appId: app.id, displayName: "Y" })

    const uniq = `CombinedFilter${Date.now()}`

    // Профиль 1: match И accountX И name содержит term → должен попасть в результат.
    const p1 = await prisma.deviceProfile.create({
      data: {
        name: `${uniq}-MATCH-1`,
        platformType: "desktop",
        syncStatus: "local_only",
        proxyId: proxy.id,
        socialAccountId: accountX.id,
        createdById: user.id,
      },
    })
    // Profile.accountX через denorm (M.1) — также добавим в IndigoProfileAccount.
    await prisma.deviceProfileAccount.create({
      data: { profileId: p1.id, socialAccountId: accountX.id, isPrimary: true },
    })

    // Профиль 2: name содержит term, но привязан к accountY → должен быть отфильтрован.
    const p2 = await prisma.deviceProfile.create({
      data: {
        name: `${uniq}-WRONG-ACCOUNT`,
        platformType: "desktop",
        syncStatus: "local_only",
        proxyId: proxy.id,
        socialAccountId: accountY.id,
        createdById: user.id,
      },
    })
    await prisma.deviceProfileAccount.create({
      data: { profileId: p2.id, socialAccountId: accountY.id, isPrimary: true },
    })

    // Профиль 3: привязан к accountX как non-primary (через accounts join, без denorm
     // на родителе — потому что accountX уже primary у p1, а socialAccountId @unique).
     // name НЕ содержит term → должен быть отфильтрован.
    const accountXShadow = await createTestSocialAccount({ appId: app.id })
    const p3 = await prisma.deviceProfile.create({
      data: {
        name: `OTHER-${Date.now()}`,
        platformType: "desktop",
        syncStatus: "local_only",
        proxyId: proxy.id,
        socialAccountId: accountXShadow.id,
        createdById: user.id,
      },
    })
    // primary — accountXShadow, second link — accountX (это та цель search).
    await prisma.deviceProfileAccount.create({
      data: { profileId: p3.id, socialAccountId: accountXShadow.id, isPrimary: true },
    })
    await prisma.deviceProfileAccount.create({
      data: { profileId: p3.id, socialAccountId: accountX.id, isPrimary: false },
    })

    const res = await $fetch<{ data: IndigoProfileDtoLike[] }>(
      `/api/device-profiles?socialAccountId=${accountX.id}&search=${encodeURIComponent(uniq)}`,
      { headers: authHeaders(user.id) },
    )

    const ids = res.data.map((p) => p.id)
    expect(ids).toContain(p1.id)
    expect(ids).not.toContain(p2.id)
    expect(ids).not.toContain(p3.id)
  })

  it("без search — фильтр socialAccountId работает (regression)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const proxy = await createTestProxy({ expectedCountry: "US", createdById: user.id })
    const accountX = await createTestSocialAccount({ appId: app.id })
    const accountY = await createTestSocialAccount({ appId: app.id })

    const p1 = await prisma.deviceProfile.create({
      data: {
        name: `OnlyX-${Date.now()}`,
        platformType: "desktop",
        syncStatus: "local_only",
        proxyId: proxy.id,
        socialAccountId: accountX.id,
        createdById: user.id,
      },
    })
    await prisma.deviceProfileAccount.create({
      data: { profileId: p1.id, socialAccountId: accountX.id, isPrimary: true },
    })

    const p2 = await prisma.deviceProfile.create({
      data: {
        name: `OnlyY-${Date.now()}`,
        platformType: "desktop",
        syncStatus: "local_only",
        proxyId: proxy.id,
        socialAccountId: accountY.id,
        createdById: user.id,
      },
    })
    await prisma.deviceProfileAccount.create({
      data: { profileId: p2.id, socialAccountId: accountY.id, isPrimary: true },
    })

    const res = await $fetch<{ data: IndigoProfileDtoLike[] }>(
      `/api/device-profiles?socialAccountId=${accountX.id}`,
      { headers: authHeaders(user.id) },
    )

    const ids = res.data.map((p) => p.id)
    expect(ids).toContain(p1.id)
    expect(ids).not.toContain(p2.id)
  })

  it("только search — фильтр работает (regression)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy({ expectedCountry: "US", createdById: user.id })

    const uniq = `SearchOnly${Date.now()}`
    const p1 = await prisma.deviceProfile.create({
      data: {
        name: `${uniq}-foo`,
        platformType: "desktop",
        syncStatus: "local_only",
        proxyId: proxy.id,
        createdById: user.id,
      },
    })
    const p2 = await prisma.deviceProfile.create({
      data: {
        name: `OTHER-${Date.now()}`,
        platformType: "desktop",
        syncStatus: "local_only",
        proxyId: proxy.id,
        createdById: user.id,
      },
    })

    const res = await $fetch<{ data: IndigoProfileDtoLike[] }>(
      `/api/device-profiles?search=${encodeURIComponent(uniq)}`,
      { headers: authHeaders(user.id) },
    )

    const ids = res.data.map((p) => p.id)
    expect(ids).toContain(p1.id)
    expect(ids).not.toContain(p2.id)
  })
})
