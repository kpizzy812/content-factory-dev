import { describe, expect, it } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"

import { nuxtTestEnv } from "../helpers/nuxt-env"
import { createTestUser, authHeaders } from "../helpers/auth"

describe("admin user credentials", async () => {
  await setup({
    dev: true,
    server: true,
    browser: false,
    env: { ...nuxtTestEnv, AUTH_PROVIDER: "local" },
  })

  it("создаёт локальную учётку и позволяет ей войти", async () => {
    const admin = await createTestUser({ email: "admin-creds@test.local", canAdmin: true })

    const created = await $fetch<{ data: { id: number; email: string } }>("/api/admin/users", {
      method: "POST",
      headers: authHeaders(admin.id),
      body: {
        email: "New.Operator@Test.local",
        password: "operator-password-1",
        name: "Operator",
        rolePreset: "operator",
        moduleAccess: ["pipeline"],
      },
    })

    expect(created.data.email).toBe("new.operator@test.local")

    const login = await $fetch<{ user: { email: string } }>("/api/auth/login", {
      method: "POST",
      body: { email: "new.operator@test.local", password: "operator-password-1" },
    })
    expect(login.user.email).toBe("new.operator@test.local")
  })

  it("не отдаёт хеш пароля в списке пользователей", async () => {
    const admin = await createTestUser({ email: "admin-list@test.local", canAdmin: true })
    const list = await $fetch("/api/admin/users", { headers: authHeaders(admin.id) })
    expect(JSON.stringify(list)).not.toContain("scrypt$")
    expect(JSON.stringify(list)).not.toContain("passwordHash")
  })

  it("меняет пароль и отклоняет короткий", async () => {
    const admin = await createTestUser({ email: "admin-rotate@test.local", canAdmin: true })
    const target = await createTestUser({ email: "rotate-me@test.local" })

    await $fetch(`/api/admin/users/${target.id}/password`, {
      method: "PUT",
      headers: authHeaders(admin.id),
      body: { password: "brand-new-password" },
    })

    const login = await $fetch<{ user: { email: string } }>("/api/auth/login", {
      method: "POST",
      body: { email: "rotate-me@test.local", password: "brand-new-password" },
    })
    expect(login.user.email).toBe("rotate-me@test.local")

    await expect($fetch(`/api/admin/users/${target.id}/password`, {
      method: "PUT",
      headers: authHeaders(admin.id),
      body: { password: "short" },
    })).rejects.toMatchObject({ statusCode: 422 })
  })

  it("отклоняет дубль email", async () => {
    const admin = await createTestUser({ email: "admin-dup@test.local", canAdmin: true })
    await expect($fetch("/api/admin/users", {
      method: "POST",
      headers: authHeaders(admin.id),
      body: { email: "admin-dup@test.local", password: "another-password-1" },
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it("не пускает не-админа", async () => {
    const plain = await createTestUser({ email: "plain@test.local", canAdmin: false })
    await expect($fetch("/api/admin/users", {
      method: "POST",
      headers: authHeaders(plain.id),
      body: { email: "x@test.local", password: "some-password-1" },
    })).rejects.toMatchObject({ statusCode: 403 })
  })
})
