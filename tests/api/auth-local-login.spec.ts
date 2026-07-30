import { describe, expect, it, beforeAll } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"

import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"
import { hashPassword } from "../../server/utils/auth/password"
import { localExternalId } from "../../server/utils/auth/identity"

describe("local login", async () => {
  await setup({
    dev: true,
    server: true,
    browser: false,
    env: { ...nuxtTestEnv, AUTH_PROVIDER: "local" },
  })

  const email = "owner@contentfactory.test"
  const password = "local-owner-password"

  beforeAll(async () => {
    const passwordHash = await hashPassword(password)
    await prisma.zavodUser.upsert({
      where: { email },
      create: {
        externalId: localExternalId(email),
        email,
        name: "Owner",
        rolePreset: "admin",
        passwordHash,
        canRead: true, canWrite: true, canCreate: true, canDelete: true,
        canApprove: true, canRunAgent: true, canApplyChanges: true, canAdmin: true,
        moduleAccess: ["pipeline"],
        isActive: true,
      },
      update: { passwordHash, isActive: true },
    })
  })

  it("пускает с верным паролем и не отдаёт хеш", async () => {
    const response = await $fetch<{ user: Record<string, unknown> }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    })
    expect(response.user.email).toBe(email)
    expect(response.user.rolePreset).toBe("admin")
    expect(JSON.stringify(response)).not.toContain("scrypt$")
  })

  it("отвечает 401 на неверный пароль и на несуществующего пользователя одинаково", async () => {
    await expect($fetch("/api/auth/login", {
      method: "POST",
      body: { email, password: "wrong-password-here" },
    })).rejects.toMatchObject({ statusCode: 401 })

    await expect($fetch("/api/auth/login", {
      method: "POST",
      body: { email: "nobody@contentfactory.test", password: "wrong-password-here" },
    })).rejects.toMatchObject({ statusCode: 401 })
  })

  it("не пускает выключенного пользователя", async () => {
    await prisma.zavodUser.update({ where: { email }, data: { isActive: false } })
    await expect($fetch("/api/auth/login", {
      method: "POST",
      body: { email, password },
    })).rejects.toMatchObject({ statusCode: 401 })
    await prisma.zavodUser.update({ where: { email }, data: { isActive: true } })
  })
})
