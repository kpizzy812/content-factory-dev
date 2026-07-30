/**
 * Integration-тесты 1:1:1 endpoints (Цикл M, post-rework):
 *   POST /api/device-profiles/[id]/accounts
 *   DELETE /api/device-profiles/[id]/accounts/[accountId]
 *   PUT /api/device-profiles/[id]/accounts/[accountId]/primary → 410 Gone
 *
 * 1:1:1 контракт: один профиль = один аккаунт = один прокси.
 *   - Второй аккаунт на тот же профиль → 409 profile_occupied.
 *   - Один аккаунт на два профиля → 409 account_already_linked.
 *   - Тот же аккаунт повторно → 200 idempotent.
 *   - PUT primary → 410 (бессмысленно при 1:1).
 *   - US-proxy guard (412 no_proxy/wrong_country/unknown) остался.
 *   - Denorm DeviceProfile.socialAccountId + SocialAccount.deviceProfileId.
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
  socialAccountId: number | null
  proxyCountryGuard: string
  accounts: Array<{
    id: number
    isPrimary: boolean
    displayName: string
  }>
}

async function createUsProfile(userId: number, name?: string) {
  const proxy = await createTestProxy({ expectedCountry: "US", createdById: userId })
  const profile = await prisma.deviceProfile.create({
    data: {
      name: name ?? `US Profile ${Date.now()}-${Math.random()}`,
      platformType: "desktop",
      syncStatus: "local_only",
      proxyId: proxy.id,
      createdById: userId,
    },
  })
  return { profile, proxy }
}

describe("POST /api/device-profiles/[id]/accounts (1:1:1)", () => {
  it("first account → linked, primary=true, denorm обновлён", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { profile } = await createUsProfile(user.id)
    const app = await createTestApp()
    const account = await createTestSocialAccount({ appId: app.id })

    const res = await $fetch<{ data: IndigoProfileDtoLike }>(
      `/api/device-profiles/${profile.id}/accounts`,
      {
        method: "POST",
        body: { socialAccountId: account.id },
        headers: authHeaders(user.id),
      },
    )

    expect(res.data.accounts).toHaveLength(1)
    expect(res.data.accounts[0]?.isPrimary).toBe(true)
    expect(res.data.socialAccountId).toBe(account.id)

    const a = await prisma.socialAccount.findUnique({ where: { id: account.id } })
    expect(a?.deviceProfileId).toBe(profile.id)
  })

  it("second account → 409 profile_occupied (1:1:1 enforcement)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { profile } = await createUsProfile(user.id)
    const app = await createTestApp()
    const a1 = await createTestSocialAccount({ appId: app.id, displayName: "A1" })
    const a2 = await createTestSocialAccount({ appId: app.id, displayName: "A2" })

    await $fetch(`/api/device-profiles/${profile.id}/accounts`, {
      method: "POST",
      body: { socialAccountId: a1.id },
      headers: authHeaders(user.id),
    })
    await expect(
      $fetch(`/api/device-profiles/${profile.id}/accounts`, {
        method: "POST",
        body: { socialAccountId: a2.id },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { data: { code: "profile_occupied", existingAccountId: a1.id } },
    })
  })

  it("same account повторно → 200 idempotent (no error)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { profile } = await createUsProfile(user.id)
    const app = await createTestApp()
    const acc = await createTestSocialAccount({ appId: app.id })

    await $fetch(`/api/device-profiles/${profile.id}/accounts`, {
      method: "POST",
      body: { socialAccountId: acc.id },
      headers: authHeaders(user.id),
    })
    const res = await $fetch<{ data: IndigoProfileDtoLike }>(
      `/api/device-profiles/${profile.id}/accounts`,
      {
        method: "POST",
        body: { socialAccountId: acc.id },
        headers: authHeaders(user.id),
      },
    )
    expect(res.data.accounts).toHaveLength(1)
    expect(res.data.socialAccountId).toBe(acc.id)
  })

  it("account уже привязан к ДРУГОМУ профилю → 409 account_already_linked", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { profile: profile1 } = await createUsProfile(user.id, "P1")
    const { profile: profile2 } = await createUsProfile(user.id, "P2")
    const app = await createTestApp()
    const acc = await createTestSocialAccount({ appId: app.id })

    await $fetch(`/api/device-profiles/${profile1.id}/accounts`, {
      method: "POST",
      body: { socialAccountId: acc.id },
      headers: authHeaders(user.id),
    })
    await expect(
      $fetch(`/api/device-profiles/${profile2.id}/accounts`, {
        method: "POST",
        body: { socialAccountId: acc.id },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: {
        data: {
          code: "account_already_linked",
          existingProfileId: profile1.id,
        },
      },
    })
  })

  it("non-US proxy → 412 wrong_country", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy({ expectedCountry: "DE", createdById: user.id })
    const profile = await prisma.deviceProfile.create({
      data: {
        name: `DE Profile ${Date.now()}`,
        platformType: "desktop",
        syncStatus: "local_only",
        proxyId: proxy.id,
        createdById: user.id,
      },
    })
    const app = await createTestApp()
    const acc = await createTestSocialAccount({ appId: app.id })

    await expect(
      $fetch(`/api/device-profiles/${profile.id}/accounts`, {
        method: "POST",
        body: { socialAccountId: acc.id },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({
      statusCode: 412,
      data: { data: { code: "wrong_country", actualCountry: "DE" } },
    })
  })

  it("no proxy на профиле → 412 no_proxy (US-guard)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const profile = await prisma.deviceProfile.create({
      data: {
        name: `No Proxy ${Date.now()}`,
        platformType: "desktop",
        syncStatus: "local_only",
        createdById: user.id,
      },
    })
    const app = await createTestApp()
    const acc = await createTestSocialAccount({ appId: app.id })

    await expect(
      $fetch(`/api/device-profiles/${profile.id}/accounts`, {
        method: "POST",
        body: { socialAccountId: acc.id },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({
      statusCode: 412,
      data: { data: { code: "no_proxy" } },
    })
  })

  it("expectedCountry=null → 412 unknown", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy({ expectedCountry: null, createdById: user.id })
    const profile = await prisma.deviceProfile.create({
      data: {
        name: `Unknown Country ${Date.now()}`,
        platformType: "desktop",
        syncStatus: "local_only",
        proxyId: proxy.id,
        createdById: user.id,
      },
    })
    const app = await createTestApp()
    const acc = await createTestSocialAccount({ appId: app.id })

    await expect(
      $fetch(`/api/device-profiles/${profile.id}/accounts`, {
        method: "POST",
        body: { socialAccountId: acc.id },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({
      statusCode: 412,
      data: { data: { code: "unknown" } },
    })
  })

  it("несуществующий profile → 404", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch(`/api/device-profiles/no-such-${Date.now()}/accounts`, {
        method: "POST",
        body: { socialAccountId: 1 },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("cross-tenant attack: non-admin без appAssignment к App аккаунта → 403", async () => {
    const appA = await createTestApp()
    const appB = await createTestApp()
    const operatorA = await createTestUser({
      canAdmin: false,
      canRead: true,
      canWrite: true,
      moduleAccess: ["social-upload"],
      appAssignments: [{ appId: appA.id, accessLevel: "full" }],
    })
    const { profile } = await createUsProfile(operatorA.id)
    const foreignAccount = await createTestSocialAccount({
      appId: appB.id,
      displayName: "Foreign B",
    })

    await expect(
      $fetch(`/api/device-profiles/${profile.id}/accounts`, {
        method: "POST",
        body: { socialAccountId: foreignAccount.id },
        headers: authHeaders(operatorA.id),
      }),
    ).rejects.toMatchObject({ statusCode: 403 })

    const ownAccount = await createTestSocialAccount({
      appId: appA.id,
      displayName: "Own A",
    })
    const res = await $fetch<{ data: IndigoProfileDtoLike }>(
      `/api/device-profiles/${profile.id}/accounts`,
      {
        method: "POST",
        body: { socialAccountId: ownAccount.id },
        headers: authHeaders(operatorA.id),
      },
    )
    expect(res.data.socialAccountId).toBe(ownAccount.id)
  })

  it("admin bypass: canAdmin может линкнуть account из любого App", async () => {
    const admin = await createTestUser({ canAdmin: true })
    const { profile } = await createUsProfile(admin.id)
    const foreignApp = await createTestApp()
    const foreignAccount = await createTestSocialAccount({
      appId: foreignApp.id,
      displayName: "Foreign for admin",
    })

    const res = await $fetch<{ data: IndigoProfileDtoLike }>(
      `/api/device-profiles/${profile.id}/accounts`,
      {
        method: "POST",
        body: { socialAccountId: foreignAccount.id },
        headers: authHeaders(admin.id),
      },
    )
    expect(res.data.socialAccountId).toBe(foreignAccount.id)
  })
})

describe("PUT /api/device-profiles/[id]/accounts/[accountId]/primary (disabled)", () => {
  it("→ 410 Gone (primary endpoint disabled при 1:1:1)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { profile } = await createUsProfile(user.id)
    const app = await createTestApp()
    const acc = await createTestSocialAccount({ appId: app.id })

    await $fetch(`/api/device-profiles/${profile.id}/accounts`, {
      method: "POST",
      body: { socialAccountId: acc.id },
      headers: authHeaders(user.id),
    })

    await expect(
      $fetch(`/api/device-profiles/${profile.id}/accounts/${acc.id}/primary`, {
        method: "PUT",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({
      statusCode: 410,
      data: { data: { code: "primary_endpoint_disabled" } },
    })
  })
})

describe("DELETE /api/device-profiles/[id]/accounts/[accountId] (1:1:1)", () => {
  it("delete единственный аккаунт → ok, denorm обнулён", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { profile } = await createUsProfile(user.id)
    const app = await createTestApp()
    const acc = await createTestSocialAccount({ appId: app.id })

    await $fetch(`/api/device-profiles/${profile.id}/accounts`, {
      method: "POST",
      body: { socialAccountId: acc.id },
      headers: authHeaders(user.id),
    })

    const res = await $fetch<{ data: IndigoProfileDtoLike }>(
      `/api/device-profiles/${profile.id}/accounts/${acc.id}`,
      { method: "DELETE", headers: authHeaders(user.id) },
    )
    expect(res.data.accounts).toHaveLength(0)
    expect(res.data.socialAccountId).toBeNull()

    const a = await prisma.socialAccount.findUnique({ where: { id: acc.id } })
    expect(a?.deviceProfileId).toBeNull()
  })

  it("delete + re-link → ok (профиль освобождается)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { profile } = await createUsProfile(user.id)
    const app = await createTestApp()
    const a1 = await createTestSocialAccount({ appId: app.id, displayName: "A1" })
    const a2 = await createTestSocialAccount({ appId: app.id, displayName: "A2" })

    await $fetch(`/api/device-profiles/${profile.id}/accounts`, {
      method: "POST",
      body: { socialAccountId: a1.id },
      headers: authHeaders(user.id),
    })
    await $fetch(`/api/device-profiles/${profile.id}/accounts/${a1.id}`, {
      method: "DELETE",
      headers: authHeaders(user.id),
    })
    const res = await $fetch<{ data: IndigoProfileDtoLike }>(
      `/api/device-profiles/${profile.id}/accounts`,
      {
        method: "POST",
        body: { socialAccountId: a2.id },
        headers: authHeaders(user.id),
      },
    )
    expect(res.data.socialAccountId).toBe(a2.id)
  })

  it("несуществующий link → 404", async () => {
    const user = await createTestUser({ canAdmin: true })
    const { profile } = await createUsProfile(user.id)

    await expect(
      $fetch(`/api/device-profiles/${profile.id}/accounts/999999`, {
        method: "DELETE",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("чужой profile → 403", async () => {
    const owner = await createTestUser({ canAdmin: true })
    const { profile } = await createUsProfile(owner.id)
    const intruder = await createTestUser({
      canAdmin: false,
      canWrite: true,
      canRead: true,
      moduleAccess: ["social-upload"],
    })

    await expect(
      $fetch(`/api/device-profiles/${profile.id}/accounts/1`, {
        method: "DELETE",
        headers: authHeaders(intruder.id),
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
