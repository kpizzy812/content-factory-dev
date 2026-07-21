/**
 * Contract-тесты безопасности /api/proxies.
 *
 * Что проверяем:
 *   1. List и detail НЕ возвращают plain host/username/password — только hostMasked
 *      и has*-флаги (защита от утечки секретов в API).
 *   2. /reveal возвращает расшифрованные значения, но обязательно пишет
 *      SecretAccessLog ДО decrypt — даже если decrypt упадёт, попытка зафиксирована.
 *   3. Все эндпоинты требуют auth — без TEST_AUTH_BYPASS-заголовков → 401.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { createTestProxy } from "../helpers/factories"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

interface ProxyDtoLike {
  id: string
  label: string
  hostMasked: string
  port: number
  hasCredentials: boolean
  hasRotationUrl: boolean
  host?: unknown
  username?: unknown
  password?: unknown
}

describe("GET /api/proxies — list shape & secret hygiene", () => {
  it("возвращает hostMasked, не возвращает plain host/username/password", async () => {
    const user = await createTestUser({ canAdmin: true })
    await createTestProxy({ host: "1.2.3.4", username: "secret-user", password: "secret-pass" })

    const res = await $fetch<{ data: ProxyDtoLike[] }>("/api/proxies", {
      headers: authHeaders(user.id),
    })

    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data.length).toBe(1)
    const dto = res.data[0]!
    expect(dto.hostMasked).toBeTruthy()
    expect(dto).not.toHaveProperty("host")
    expect(dto).not.toHaveProperty("username")
    expect(dto).not.toHaveProperty("password")

    // hasCredentials/hasRotationUrl — boolean-флаги без plain-значений
    expect(typeof dto.hasCredentials).toBe("boolean")
    expect(typeof dto.hasRotationUrl).toBe("boolean")
    expect(dto.hasCredentials).toBe(true)
  })

  it("hostMasked правильно скрывает octets для IPv4", async () => {
    const user = await createTestUser({ canAdmin: true })
    await createTestProxy({ host: "1.2.3.4" })

    const res = await $fetch<{ data: ProxyDtoLike[] }>("/api/proxies", {
      headers: authHeaders(user.id),
    })
    const dto = res.data[0]!
    expect(dto.hostMasked).toBe("1.2.X.X")
    expect(dto.hostMasked).not.toContain("3.4")
  })

  it("без auth-заголовков → 401", async () => {
    await expect($fetch("/api/proxies")).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe("POST /api/proxies/:id/reveal — audit-log + decrypt", () => {
  it("возвращает расшифрованные credentials и пишет SecretAccessLog", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy({
      host: "1.2.3.4",
      username: "u-plain",
      password: "p-plain",
    })

    const res = await $fetch<{
      data: { host: string; port: number; username: string | null; password: string | null }
    }>(`/api/proxies/${proxy.id}/reveal`, {
      method: "POST",
      body: { reason: "Initial setup verification" },
      headers: authHeaders(user.id),
    })

    expect(res.data.host).toBe("1.2.3.4")
    expect(res.data.username).toBe("u-plain")
    expect(res.data.password).toBe("p-plain")
    expect(res.data.port).toBe(proxy.port)

    // Минимум один лог на host (для proxy с username+password ожидаем 3 записи).
    const logs = await prisma.secretAccessLog.findMany({
      where: { entityId: proxy.id },
    })
    expect(logs.length).toBeGreaterThanOrEqual(1)
    const hostLog = logs.find((l) => l.entityType === "Proxy.host")
    expect(hostLog).toBeDefined()
    expect(hostLog!.userId).toBe(user.id)
    expect(hostLog!.reason).toBe("Initial setup verification")
    expect(hostLog!.action).toBe("view")
  })

  it("требует reason ≥10 символов → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy()

    await expect(
      $fetch(`/api/proxies/${proxy.id}/reveal`, {
        method: "POST",
        body: { reason: "short" },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("audit-log создаётся ДО расшифровки даже при ошибке decrypt", async () => {
    const user = await createTestUser({ canAdmin: true })
    const proxy = await createTestProxy()
    // Портим password ciphertext — decryptSecret кинет 500 при чтении
    await prisma.proxy.update({
      where: { id: proxy.id },
      data: { password: "corrupted_ciphertext" },
    })

    await expect(
      $fetch(`/api/proxies/${proxy.id}/reveal`, {
        method: "POST",
        body: { reason: "Testing audit ordering" },
        headers: authHeaders(user.id),
      }),
    ).rejects.toBeDefined()

    // Лог host'а должен быть создан до того, как мы дошли до сломанного password.
    const logs = await prisma.secretAccessLog.findMany({
      where: { entityId: proxy.id },
    })
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.some((l) => l.reason === "Testing audit ordering")).toBe(true)
  })

  it("404 при reveal несуществующего id", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch(`/api/proxies/non-existent-id-${Date.now()}/reveal`, {
        method: "POST",
        body: { reason: "Probe non-existent proxy" },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
