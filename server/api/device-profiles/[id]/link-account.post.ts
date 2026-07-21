/**
 * POST /api/device-profiles/:id/link-account
 * Привязывает Indigo-профиль к SocialAccount (1:1).
 * Body: { socialAccountId: number }
 */
import { toDeviceProfileDto } from "~~/server/utils/posting-provider/dto"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор" })
  }

  const body = await readBody<{ socialAccountId?: number }>(event)
  const accountId = Number(body?.socialAccountId)
  if (!Number.isFinite(accountId) || accountId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'socialAccountId' обязательно (положительное число)",
    })
  }

  const profile = await prisma.deviceProfile.findUnique({ where: { id } })
  if (!profile) {
    throw createError({ statusCode: 404, message: "Indigo-профиль не найден" })
  }

  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } })
  if (!account) {
    throw createError({ statusCode: 404, message: "Социальный аккаунт не найден" })
  }

  const conflict = await prisma.deviceProfile.findUnique({
    where: { socialAccountId: accountId },
  })
  if (conflict && conflict.id !== id) {
    throw createError({
      statusCode: 409,
      message: `У этого аккаунта уже привязан профиль "${conflict.name}"`,
    })
  }

  const updated = await prisma.deviceProfile.update({
    where: { id },
    data: { socialAccountId: accountId },
    include: {
      socialAccount: { include: { app: { select: { id: true, name: true } } } },
      proxy: { select: { id: true, label: true, status: true, type: true, expectedCountry: true } },
      accounts: {
        include: { socialAccount: { include: { app: { select: { id: true, name: true } } } } },
        orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
      },
    },
  })

  // Обновляем denormalized SocialAccount.deviceProfileId для совместимости
  await prisma.socialAccount.update({
    where: { id: accountId },
    data: { deviceProfileId: id },
  })

  return { data: toDeviceProfileDto(updated) }
})
