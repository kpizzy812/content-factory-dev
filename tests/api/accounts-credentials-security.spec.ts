/**
 * Contract-тесты безопасности login-credentials SocialAccount.
 *
 * Что проверяем:
 *   1. PUT /api/accounts/:id/credentials — шифрует loginPassword/twoFASecret/email
 *      в БД (не сохраняет plain), валидирует enum-поля.
 *   2. POST /api/accounts/:id/credentials/reveal — отдаёт plain ОДНОГО поля
 *      и обязательно пишет SecretAccessLog с правильным entityType.
 *   3. GET /api/accounts — НЕ возвращает loginEmail/loginPassword (даже как
 *      зашифрованные строки), только hasLoginCredentials boolean.
 *   4. Любой эндпоинт без auth → 401.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { createTestSocialAccount } from "../helpers/factories"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

interface AccountListItem {
  id: number
  displayName: string
  hasLoginCredentials: boolean
  loginEmail?: unknown
  loginPassword?: unknown
}

describe("GET /api/accounts — list shape & secret hygiene", () => {
  it("не возвращает loginEmail/loginPassword даже в зашифрованном виде", async () => {
    const user = await createTestUser({ canAdmin: true })
    await createTestSocialAccount({
      displayName: "TikTok demo",
      loginEmail: "secret@example.com",
      loginPassword: "super-secret",
    })

    const res = await $fetch<{ data: AccountListItem[] }>("/api/accounts", {
      headers: authHeaders(user.id),
    })

    expect(res.data.length).toBe(1)
    const acc = res.data[0]!
    expect(acc).not.toHaveProperty("loginEmail")
    expect(acc).not.toHaveProperty("loginPassword")
    expect(acc.hasLoginCredentials).toBe(true)
  })

  it("без auth → 401", async () => {
    await expect($fetch("/api/accounts")).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe("PUT /api/accounts/:id/credentials — encryption at rest", () => {
  it("шифрует loginPassword/twoFASecret/email при сохранении в БД", async () => {
    const user = await createTestUser({ canAdmin: true })
    const account = await createTestSocialAccount({})

    await $fetch(`/api/accounts/${account.id}/credentials`, {
      method: "PUT",
      body: {
        loginEmail: "user@example.com",
        loginPassword: "plain-password",
        twoFASecret: "JBSWY3DPEHPK3PXP",
      },
      headers: authHeaders(user.id),
    })

    const fresh = await prisma.socialAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: { loginEmail: true, loginPassword: true, twoFASecret: true },
    })

    // Все три поля должны быть в формате ivHex:authTagHex:ciphertextHex
    for (const value of [fresh.loginEmail, fresh.loginPassword, fresh.twoFASecret]) {
      expect(value).toBeTruthy()
      expect(value).not.toBe("plain-password")
      expect(value).not.toBe("user@example.com")
      expect(value).not.toBe("JBSWY3DPEHPK3PXP")
      expect(value!.split(":").length).toBe(3)
    }
  })

  it("валидирует enum warmupStatus → 400 на невалидном значении", async () => {
    const user = await createTestUser({ canAdmin: true })
    const account = await createTestSocialAccount({})

    await expect(
      $fetch(`/api/accounts/${account.id}/credentials`, {
        method: "PUT",
        body: { warmupStatus: "frozen" },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 при PUT credentials несуществующего id", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch(`/api/accounts/9999999/credentials`, {
        method: "PUT",
        body: { loginEmail: "x@y.z" },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("POST /api/accounts/:id/credentials/reveal — audit-log + decrypt", () => {
  it("возвращает plain значение и пишет SecretAccessLog с правильным entityType", async () => {
    const user = await createTestUser({ canAdmin: true })
    const account = await createTestSocialAccount({
      loginPassword: "real-password-123",
    })

    const res = await $fetch<{ data: { value: string } }>(
      `/api/accounts/${account.id}/credentials/reveal`,
      {
        method: "POST",
        body: { field: "loginPassword", reason: "Operator login attempt audit" },
        headers: authHeaders(user.id),
      },
    )
    expect(res.data.value).toBe("real-password-123")

    const log = await prisma.secretAccessLog.findFirst({
      where: { entityId: String(account.id), entityType: "SocialAccount.loginPassword" },
    })
    expect(log).not.toBeNull()
    expect(log!.userId).toBe(user.id)
    expect(log!.reason).toBe("Operator login attempt audit")
    expect(log!.action).toBe("view")
  })

  it("требует reason ≥10 символов → 400", async () => {
    const user = await createTestUser({ canAdmin: true })
    const account = await createTestSocialAccount({ loginPassword: "p" })
    await expect(
      $fetch(`/api/accounts/${account.id}/credentials/reveal`, {
        method: "POST",
        body: { field: "loginPassword", reason: "short" },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("отказывает на невалидном field → 400 (whitelist enforcement)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const account = await createTestSocialAccount({ loginPassword: "p" })
    await expect(
      $fetch(`/api/accounts/${account.id}/credentials/reveal`, {
        method: "POST",
        body: { field: "accessToken", reason: "Trying to bypass whitelist" },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 если field существует в whitelist, но значение не задано", async () => {
    const user = await createTestUser({ canAdmin: true })
    // Аккаунт без twoFASecret
    const account = await createTestSocialAccount({ loginPassword: "p" })
    await expect(
      $fetch(`/api/accounts/${account.id}/credentials/reveal`, {
        method: "POST",
        body: { field: "twoFASecret", reason: "Probe missing 2FA secret" },
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
