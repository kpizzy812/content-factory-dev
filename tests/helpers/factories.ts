/**
 * Фабрики моделей для интеграционных тестов.
 *
 * Правило: возвращать готовый объект из БД, без лишних побочных эффектов.
 * Все фабрики используют общий prisma singleton (server/utils/prisma)
 * и тестовую обёртку testEncrypt() для шифрованных полей.
 */
import { prisma } from "../../server/utils/prisma"
import { createTestUser } from "./auth"
import { testEncrypt } from "./test-crypto"

export { createTestUser }

interface CreateTestAppOverrides {
  name?: string
  description?: string | null
  keywords?: string[]
}

export async function createTestApp(overrides: CreateTestAppOverrides = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.app.create({
    data: {
      name: overrides.name ?? `Test App ${seed}`,
      description: overrides.description ?? null,
      keywords: overrides.keywords ?? [],
    },
  })
}

interface CreateTestProxyOverrides {
  label?: string
  type?: "mobile" | "residential" | "datacenter"
  protocol?: "http" | "https" | "socks5"
  host?: string
  port?: number
  username?: string | null
  password?: string | null
  rotationUrl?: string | null
  expectedCountry?: string | null
  createdById?: number
}

/**
 * Создаёт Proxy с шифрованными host/username/password (в формате, который
 * читает decryptSecret/readSecret в API). Если createdById не передан,
 * автоматически создаёт нового ZavodUser.
 */
export async function createTestProxy(overrides: CreateTestProxyOverrides = {}) {
  let createdById = overrides.createdById
  if (!createdById) {
    const u = await createTestUser()
    createdById = u.id
  }

  const seed = Math.floor(Math.random() * 1_000_000_000)
  const host = overrides.host ?? "1.2.3.4"

  const usernameRaw =
    overrides.username === undefined ? "user" : overrides.username
  const passwordRaw =
    overrides.password === undefined ? "pass" : overrides.password

  return prisma.proxy.create({
    data: {
      label: overrides.label ?? `Test Proxy ${seed}`,
      type: overrides.type ?? "mobile",
      protocol: overrides.protocol ?? "http",
      host: testEncrypt(host),
      port: overrides.port ?? 1080,
      username: usernameRaw === null ? null : testEncrypt(usernameRaw),
      password: passwordRaw === null ? null : testEncrypt(passwordRaw),
      rotationUrl:
        overrides.rotationUrl == null ? null : testEncrypt(overrides.rotationUrl),
      expectedCountry: overrides.expectedCountry ?? null,
      createdById,
    },
  })
}

interface CreateTestSocialAccountOverrides {
  appId?: number
  platform?: "youtube" | "tiktok" | "instagram"
  displayName?: string
  platformHandle?: string | null
  loginEmail?: string | null
  loginPassword?: string | null
  recoveryEmail?: string | null
  recoveryPhone?: string | null
  twoFASecret?: string | null
  proxyId?: string | null
  accessToken?: string
  postingMethod?: "api" | "browser_automation"
  deviceProfileId?: string | null
}

/**
 * Создаёт SocialAccount с шифрованными login-полями. accessToken шифруется
 * всегда (значение по умолчанию — "test-access-token"), остальные secret-поля
 * шифруются только если переданы непустыми.
 */
export async function createTestSocialAccount(
  overrides: CreateTestSocialAccountOverrides = {},
) {
  let appId = overrides.appId
  if (!appId) {
    const app = await createTestApp()
    appId = app.id
  }

  const enc = (v: string | null | undefined) =>
    v == null || v === "" ? null : testEncrypt(v)

  return prisma.socialAccount.create({
    data: {
      appId,
      platform: overrides.platform ?? "youtube",
      displayName: overrides.displayName ?? "Test Account",
      platformHandle: overrides.platformHandle ?? null,
      accessToken: testEncrypt(overrides.accessToken ?? "test-access-token"),
      loginEmail: enc(overrides.loginEmail),
      loginPassword: enc(overrides.loginPassword),
      recoveryEmail: enc(overrides.recoveryEmail),
      recoveryPhone: enc(overrides.recoveryPhone),
      twoFASecret: enc(overrides.twoFASecret),
      proxyId: overrides.proxyId ?? null,
      deviceProfileId: overrides.deviceProfileId ?? null,
      postingMethod: overrides.postingMethod ?? "api",
      status: "active",
    },
  })
}
