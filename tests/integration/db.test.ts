/**
 * Integration smoke: проверяет что миграции применились, Prisma подключается
 * к test-БД и TRUNCATE между тестами работает корректно.
 */
import { describe, it, expect } from "vitest"
import { prisma } from "../../server/utils/prisma"
import { createTestUser } from "../helpers/auth"

describe("prisma test DB", () => {
  it("создаёт и читает ZavodUser", async () => {
    const user = await createTestUser({ email: `db-test-${Date.now()}@example.test` })
    expect(user.id).toBeGreaterThan(0)

    const found = await prisma.zavodUser.findUnique({ where: { id: user.id } })
    expect(found).not.toBeNull()
    expect(found?.email).toBe(user.email)
  })

  it("после afterEach TRUNCATE таблица пустая (изоляция)", async () => {
    const count = await prisma.zavodUser.count()
    // Если предыдущий test оставил юзера, TRUNCATE его смыл — count должен быть 0.
    expect(count).toBe(0)

    await createTestUser()
    const after = await prisma.zavodUser.count()
    expect(after).toBe(1)
  })
})
