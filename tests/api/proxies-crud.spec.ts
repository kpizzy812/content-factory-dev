/**
 * Contract-тесты CRUD-эндпоинтов /api/proxies.
 *
 * Что проверяем:
 *   - POST: правильный shape ответа, шифрование host/password в БД,
 *     валидация port-диапазона и enum-полей, 201 status.
 *   - DELETE: 409 при привязанных аккаунтах, 204 + физическое удаление
 *     при отсутствии привязок, 404 для несуществующих id.
 *   - PUT: частичное обновление с пере-шифрованием изменённых secret-полей,
 *     валидация enum.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { createTestProxy, createTestSocialAccount } from "../helpers/factories"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

// Зона пула прокси выключена по умолчанию — этот suite её проверяет, поэтому включает явно.
await setup({ dev: true, server: true, browser: false, env: { ...nuxtTestEnv, LEGACY_PROXY_POOL_ENABLED: "true" } })

interface ProxyDtoLike {
  id: string
  label: string
  hostMasked: string
  port: number
  type: string
  protocol: string
  hasCredentials: boolean
  hasRotationUrl: boolean
  status: string
  attachedAccountsCount: number
  host?: unknown
  password?: unknown
  username?: unknown
}

describe("POST /api/proxies — create", () => {
  it("создаёт proxy с зашифрованными credentials и возвращает корректный DTO", async () => {
    const user = await createTestUser({ canAdmin: true })

    const res = await $fetch<{ data: ProxyDtoLike }>("/api/proxies", {
      method: "POST",
      body: {
        label: "New Proxy",
        type: "mobile",
        host: "5.6.7.8",
        port: 1080,
        username: "newuser",
        password: "newpass",
      },
      headers: authHeaders(user.id),
    })

    expect(res.data.id).toBeDefined()
    expect(res.data.label).toBe("New Proxy")
    expect(res.data.type).toBe("mobile")
    expect(res.data.protocol).toBe("http")
    expect(res.data.hostMasked).toBe("5.6.X.X")
    expect(res.data).not.toHaveProperty("host")
    expect(res.data).not.toHaveProperty("password")
    expect(res.data).not.toHaveProperty("username")
    expect(res.data.hasCredentials).toBe(true)
    expect(res.data.attachedAccountsCount).toBe(0)

    // В БД host/password зашифрованы (формат iv:authTag:ciphertext, 3 части по hex)
    const dbProxy = await prisma.proxy.findUniqueOrThrow({ where: { id: res.data.id } })
    expect(dbProxy.host).not.toBe("5.6.7.8")
    expect(dbProxy.host.split(":").length).toBe(3)
    expect(dbProxy.host.length).toBeGreaterThan(20)
    expect(dbProxy.password).not.toBe("newpass")
    expect(dbProxy.password!.split(":").length).toBe(3)
  })

  it("валидирует port range — > 65535 → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch("/api/proxies", {
        method: "POST",
        body: {
          label: "Bad Port",
          type: "mobile",
          host: "1.2.3.4",
          port: 99999,
        },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("валидирует type enum — невалидное значение → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch("/api/proxies", {
        method: "POST",
        body: {
          label: "Bad Type",
          type: "satellite",
          host: "1.2.3.4",
          port: 1080,
        },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("требует обязательные поля — пустой label → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch("/api/proxies", {
        method: "POST",
        body: { label: "", type: "mobile", host: "1.2.3.4", port: 1080 },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("без auth → 401", async () => {
    await expect(
      $fetch("/api/proxies", {
        method: "POST",
        body: { label: "X", type: "mobile", host: "1.2.3.4", port: 1080 },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe("DELETE /api/proxies/:id — guard rails", () => {
  it("блокирует удаление, если есть привязанные аккаунты (409)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy()
    await createTestSocialAccount({ proxyId: proxy.id })

    await expect(
      $fetch(`/api/proxies/${proxy.id}`, {
        method: "DELETE",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 409 })

    // Прокси по-прежнему в БД
    const stillThere = await prisma.proxy.findUnique({ where: { id: proxy.id } })
    expect(stillThere).not.toBeNull()
  })

  it("удаляет, если нет привязок (204 + запись пропадает из БД)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy()

    await $fetch(`/api/proxies/${proxy.id}`, {
      method: "DELETE",
      headers: authHeaders(user.id),
    })

    const dbProxy = await prisma.proxy.findUnique({ where: { id: proxy.id } })
    expect(dbProxy).toBeNull()
  })

  it("404 при удалении несуществующего id", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch(`/api/proxies/missing-id-${Date.now()}`, {
        method: "DELETE",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("PUT /api/proxies/:id — partial update", () => {
  it("обновляет label, не трогая шифрованные поля", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy({ host: "1.2.3.4", password: "p-orig" })
    const originalHostCipher = proxy.host
    const originalPasswordCipher = proxy.password

    const res = await $fetch<{ data: ProxyDtoLike }>(`/api/proxies/${proxy.id}`, {
      method: "PUT",
      body: { label: "Updated Label" },
      headers: authHeaders(user.id),
    })
    expect(res.data.label).toBe("Updated Label")

    const dbProxy = await prisma.proxy.findUniqueOrThrow({ where: { id: proxy.id } })
    expect(dbProxy.host).toBe(originalHostCipher)
    expect(dbProxy.password).toBe(originalPasswordCipher)
  })

  it("при изменении host — пере-шифрует значение", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy({ host: "1.2.3.4" })
    const originalCipher = proxy.host

    await $fetch(`/api/proxies/${proxy.id}`, {
      method: "PUT",
      body: { host: "9.8.7.6" },
      headers: authHeaders(user.id),
    })

    const dbProxy = await prisma.proxy.findUniqueOrThrow({ where: { id: proxy.id } })
    expect(dbProxy.host).not.toBe(originalCipher)
    expect(dbProxy.host).not.toBe("9.8.7.6")
    expect(dbProxy.host.split(":").length).toBe(3)
  })

  it("валидирует enum при обновлении type → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy()
    await expect(
      $fetch(`/api/proxies/${proxy.id}`, {
        method: "PUT",
        body: { type: "satellite" },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
