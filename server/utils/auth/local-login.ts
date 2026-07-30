import type { ZavodUser } from "~~/app/generated/prisma/client"

import { normalizeEmail } from "./identity"
import { verifyPassword } from "./password"

/**
 * Ответ на неизвестный email и на неверный пароль одинаков, чтобы форма входа
 * не работала как оракул существующих учёток.
 */
export async function authenticateLocalUser(email: string, password: string): Promise<ZavodUser> {
  const invalid = () => createError({ statusCode: 401, message: "Неверный email или пароль" })

  const user = await prisma.zavodUser.findUnique({ where: { email: normalizeEmail(email) } })
  if (!user || !user.isActive) {
    // Прогоняем проверку вхолостую, чтобы время ответа не выдавало отсутствие учётки.
    await verifyPassword(password, null)
    throw invalid()
  }

  if (!(await verifyPassword(password, user.passwordHash))) throw invalid()

  return prisma.zavodUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })
}
