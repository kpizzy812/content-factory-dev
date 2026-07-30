import { describe, expect, it } from "vitest"

import { assertPasswordPolicy, hashPassword, verifyPassword } from "~~/server/utils/auth/password"

describe("password hashing", () => {
  it("подтверждает верный пароль и отвергает неверный", async () => {
    const stored = await hashPassword("correct horse battery")
    expect(await verifyPassword("correct horse battery", stored)).toBe(true)
    expect(await verifyPassword("wrong horse battery", stored)).toBe(false)
  })

  it("даёт разный хеш для одного пароля из-за соли", async () => {
    const first = await hashPassword("same password 123")
    const second = await hashPassword("same password 123")
    expect(first).not.toBe(second)
    expect(await verifyPassword("same password 123", first)).toBe(true)
    expect(await verifyPassword("same password 123", second)).toBe(true)
  })

  it("пишет разбираемый формат scrypt без сырого пароля", async () => {
    const stored = await hashPassword("secret value 12345")
    expect(stored.startsWith("scrypt$")).toBe(true)
    expect(stored.split("$")).toHaveLength(6)
    expect(stored).not.toContain("secret value")
  })

  it("не падает и возвращает false на пустом или битом хеше", async () => {
    expect(await verifyPassword("whatever", null)).toBe(false)
    expect(await verifyPassword("whatever", "")).toBe(false)
    expect(await verifyPassword("whatever", "not-a-hash")).toBe(false)
    expect(await verifyPassword("whatever", "scrypt$16384$8$1$zz$zz")).toBe(false)
  })

  it("требует минимум 12 символов", () => {
    expect(() => assertPasswordPolicy("short")).toThrow()
    expect(() => assertPasswordPolicy("123456789012")).not.toThrow()
  })
})
