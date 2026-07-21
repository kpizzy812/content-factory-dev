/**
 * DEV ONLY — установить сессию для указанного userId.
 * Используется Playwright тестами для обхода MC OAuth в dev-режиме.
 * Работает ТОЛЬКО при NODE_ENV !== production.
 */
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === "production") {
    throw createError({ statusCode: 404 })
  }

  const body = await readBody<{ userId?: number }>(event)
  if (!body?.userId) {
    throw createError({ statusCode: 400, message: "userId required" })
  }

  const user = await prisma.zavodUser.findUnique({
    where: { id: body.userId },
  })

  if (!user || !user.isActive) {
    throw createError({ statusCode: 404, message: "User not found" })
  }

  await setUserSession(event, {
    user: {
      id: user.id,
      externalId: user.externalId,
      email: user.email,
      name: user.name,
      surname: user.surname,
      rolePreset: user.rolePreset,
    },
  })

  return { ok: true, userId: user.id, email: user.email }
})
