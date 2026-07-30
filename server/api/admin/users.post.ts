/**
 * POST /api/admin/users
 * Создание локальной учётки ContentFactory. Пароль хешируется scrypt и наружу
 * не возвращается ни в каком виде.
 */
import type { RolePreset } from "~~/app/generated/prisma/client"

import { assertPasswordPolicy, hashPassword } from "~~/server/utils/auth/password"
import { localExternalId, normalizeEmail } from "~~/server/utils/auth/identity"

const ROLE_PRESETS = ["admin", "producer", "operator", "analyst", "observer"] as const

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const body = await readBody<{
    email?: string
    password?: string
    name?: string
    surname?: string
    rolePreset?: string
    moduleAccess?: string[]
  }>(event)

  if (!body?.email || !body?.password) {
    throw createError({ statusCode: 400, message: "Email и пароль обязательны" })
  }

  const email = normalizeEmail(body.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, message: "Некорректный формат email" })
  }
  assertPasswordPolicy(body.password)

  const rolePreset = (body.rolePreset ?? "operator") as RolePreset
  if (!ROLE_PRESETS.includes(rolePreset as typeof ROLE_PRESETS[number])) {
    throw createError({
      statusCode: 400,
      message: `rolePreset должен быть одним из: ${ROLE_PRESETS.join(", ")}`,
    })
  }

  const existing = await prisma.zavodUser.findUnique({ where: { email }, select: { id: true } })
  if (existing) throw createError({ statusCode: 409, message: "Пользователь с таким email уже есть" })

  const user = await prisma.zavodUser.create({
    data: {
      externalId: localExternalId(email),
      email,
      name: body.name?.trim() || null,
      surname: body.surname?.trim() || null,
      rolePreset,
      passwordHash: await hashPassword(body.password),
      moduleAccess: Array.isArray(body.moduleAccess) ? body.moduleAccess : [],
      isActive: true,
    },
    select: {
      id: true, externalId: true, email: true, name: true, surname: true,
      rolePreset: true, moduleAccess: true, isActive: true, createdAt: true,
    },
  })

  return { data: user }
})
