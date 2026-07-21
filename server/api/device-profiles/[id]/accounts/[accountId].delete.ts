/**
 * DELETE /api/device-profiles/:id/accounts/:accountId
 *
 * Отвязка SocialAccount от IndigoProfile (1:1:1 модель).
 *
 * Логика проста: при 1:1 у профиля максимум один аккаунт, удаление == освобождение профиля.
 * Транзакция:
 *   1. Удаляем DeviceProfileAccount запись.
 *   2. Обнуляем denorm DeviceProfile.socialAccountId.
 *   3. Обнуляем denorm SocialAccount.deviceProfileId.
 *
 * Permissions: canWrite + tenant isolation.
 */

import { toDeviceProfileDto } from "~~/server/utils/posting-provider/dto"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const profileId = getRouterParam(event, "id")
  await requireProfileOwnership(profileId, user)

  const accountIdParam = getRouterParam(event, "accountId")
  const accountId = Number(accountIdParam)
  if (!Number.isFinite(accountId) || accountId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Неверный 'accountId' (положительное число)",
    })
  }

  const link = await prisma.deviceProfileAccount.findUnique({
    where: {
      profileId_socialAccountId: { profileId: profileId as string, socialAccountId: accountId },
    },
    select: { id: true },
  })
  if (!link) {
    throw createError({ statusCode: 404, message: "Привязка не найдена" })
  }

  await prisma.$transaction(async (tx) => {
    await tx.deviceProfileAccount.delete({
      where: {
        profileId_socialAccountId: { profileId: profileId as string, socialAccountId: accountId },
      },
    })
    await tx.deviceProfile.update({
      where: { id: profileId as string },
      data: { socialAccountId: null },
    })
    await tx.socialAccount.update({
      where: { id: accountId },
      data: { deviceProfileId: null },
    })
  })

  const updated = await prisma.deviceProfile.findUnique({
    where: { id: profileId as string },
    include: {
      socialAccount: { include: { app: { select: { id: true, name: true } } } },
      proxy: { select: { id: true, label: true, status: true, type: true, expectedCountry: true } },
      accounts: {
        include: { socialAccount: { include: { app: { select: { id: true, name: true } } } } },
        orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
      },
    },
  })

  return { data: updated ? toDeviceProfileDto(updated) : null }
})
