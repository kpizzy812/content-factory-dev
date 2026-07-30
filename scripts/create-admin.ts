/**
 * Создаёт или обновляет локального администратора ContentFactory.
 *
 * Запуск: bun run create:admin owner@example.com "длинный пароль"
 *
 * Пароль передаётся аргументом и не пишется в логи. Скрипт идемпотентен:
 * повторный запуск обновляет пароль и права существующей учётки.
 */

import { prisma } from "../server/utils/prisma"
import { assertPasswordPolicy, hashPassword } from "../server/utils/auth/password"
import { localExternalId, normalizeEmail } from "../server/utils/auth/identity"

const [rawEmail, rawPassword] = process.argv.slice(2)

if (!rawEmail || !rawPassword) {
  console.error("Usage: bun run create:admin <email> <password>")
  process.exit(1)
}

const email = normalizeEmail(rawEmail)
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Некорректный формат email")
  process.exit(1)
}
assertPasswordPolicy(rawPassword)

const permissions = {
  rolePreset: "admin" as const,
  canRead: true,
  canWrite: true,
  canCreate: true,
  canDelete: true,
  canApprove: true,
  canRunAgent: true,
  canApplyChanges: true,
  canAdmin: true,
  moduleAccess: [
    "trendwatcher",
    "script-generator",
    "video-generator",
    "social-upload",
    "analytics",
    "pipeline",
  ],
  isActive: true,
}

const passwordHash = await hashPassword(rawPassword)

const user = await prisma.zavodUser.upsert({
  where: { email },
  create: { externalId: localExternalId(email), email, passwordHash, ...permissions },
  update: { passwordHash, ...permissions },
})

console.log(`Администратор готов: id=${user.id} email=${user.email}`)
await prisma.$disconnect()
