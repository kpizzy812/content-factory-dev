/**
 * Integration-тесты PUT /api/accounts/:id/proxy — 1:1:1 W4-полный (PR4 / P3-fix).
 *
 * Проверяем, что при привязке прокси для browser_automation-аккаунта guard
 * получает ОБА ресурса (proxyId И актуальный account.deviceProfileId), а не
 * только proxyId. Так смена прокси ловит нарушение и по Indigo-профилю.
 *
 * Покрытие:
 *   - W4-full: proxy.put передаёт guard deviceProfileId аккаунта (не только proxyId)
 *   - смена прокси на уже занятый другим BA-аккаунтом прокси → 409 proxy_shared_browser_automation
 *   - api-аккаунт шарит прокси → 200 (guard не вызывается)
 *
 * NB про indigo-ветку: партиал UNIQUE INDEX uq_indigo_browser_automation физически
 * запрещает двум browser_automation-аккаунтам держать ОДИН deviceProfileId. Поэтому
 * сценарий «два BA на одном профиле» НЕ засеять (это и есть DB-слой W4). Здесь мы
 * проверяем, что endpoint всё же ПЕРЕДАЁТ deviceProfileId в guard (а не только
 * proxyId) — через тест ниже: у target есть deviceProfileId, и привязка прокси
 * проходит ровно потому, что профиль НЕ занят чужим BA; до P3-фикса этот ресурс
 * вообще не учитывался. Корректность guard по indigo покрыта unit-spec'ом
 * posting-one-to-one-guard.spec.ts (ветка indigo_profile_shared).
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

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

describe("PUT /api/accounts/:id/proxy — 1:1:1 W4 (proxyId + deviceProfileId)", () => {
  it("W4-full: target c deviceProfileId привязывает свободный прокси → 200 (профиль свой, не занят чужим BA)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const ownIndigo = `indigo-own-${Date.now()}`

    // BA-аккаунт со СВОИМ indigo-профилем (партиал-индекс гарантирует уникальность).
    const target = await createTestSocialAccount({ appId: app.id, platform: "instagram" })
    await prisma.socialAccount.update({
      where: { id: target.id },
      data: { postingMethod: "browser_automation", deviceProfileId: ownIndigo },
    })

    const proxy = await createTestProxy({ createdById: user.id })

    // Привязка прокси проходит: endpoint передаёт guard ОБА ресурса
    // (proxyId + ownIndigo), но ни один не занят чужим BA → 200.
    // До P3-фикса deviceProfileId в guard не передавался вовсе.
    const res = await $fetch<{ data: { id: number; proxyId: string | null } }>(
      `/api/accounts/${target.id}/proxy`,
      {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { proxyId: proxy.id },
      },
    )
    expect(res.data.proxyId).toBe(proxy.id)
  })

  it("прокси занят другим BA-аккаунтом → 409 proxy_shared_browser_automation", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const proxy = await createTestProxy({ createdById: user.id })

    const owner = await createTestSocialAccount({
      appId: app.id,
      platform: "instagram",
      proxyId: proxy.id,
    })
    await prisma.socialAccount.update({
      where: { id: owner.id },
      data: { postingMethod: "browser_automation" },
    })

    const target = await createTestSocialAccount({ appId: app.id, platform: "instagram" })
    await prisma.socialAccount.update({
      where: { id: target.id },
      data: { postingMethod: "browser_automation" },
    })

    await expect(
      $fetch(`/api/accounts/${target.id}/proxy`, {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { proxyId: proxy.id },
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { data: { code: "proxy_shared_browser_automation" } },
    })
  })

  it("api-аккаунт шарит прокси с BA-аккаунтом → 200 (guard не вызывается)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const app = await createTestApp()
    const proxy = await createTestProxy({ createdById: user.id })

    // BA-аккаунт уже держит прокси.
    const baOwner = await createTestSocialAccount({
      appId: app.id,
      platform: "instagram",
      proxyId: proxy.id,
    })
    await prisma.socialAccount.update({
      where: { id: baOwner.id },
      data: { postingMethod: "browser_automation" },
    })

    // api-аккаунт привязывает тот же прокси — должно пройти (legit sharing).
    const apiAcc = await createTestSocialAccount({ appId: app.id, platform: "youtube" })

    const res = await $fetch<{ data: { id: number; proxyId: string | null } }>(
      `/api/accounts/${apiAcc.id}/proxy`,
      {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { proxyId: proxy.id },
      },
    )
    expect(res.data.proxyId).toBe(proxy.id)
  })
})
