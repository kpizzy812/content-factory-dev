/**
 * POST /api/device-profiles/:id/unlink-account
 * Отвязывает SocialAccount от профиля (нормализованная таблица + denorm).
 *
 * Идемпотентный: повторный вызов на уже отвязанный профиль возвращает 200 OK
 * (а не 409). Это нужно потому что раньше endpoint обновлял только denorm поля
 * (DeviceProfile.socialAccountId + SocialAccount.deviceProfileId), но НЕ удалял
 * запись из DeviceProfileAccount — после такого unlink повторная попытка
 * привязки к ДРУГОМУ профилю валилась с 409 account_already_linked (enforcement
 * B находил орфан-запись в DeviceProfileAccount). Self-healing внутри транзакции
 * очищает и нормализованную таблицу.
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

  const existing = await prisma.deviceProfile.findUnique({
    where: { id },
    include: {
      accounts: { select: { socialAccountId: true } },
    },
  })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Indigo-профиль не найден" })
  }

  // Атомарная очистка: и normalized таблица, и denorm поля.
  //
  // accountIds собираем из обоих источников (denorm + normalized) — это покрывает
  // случай "наполовину отвязан" из-за прошлой версии endpoint'а (где чистились
  // только denorm поля, и записи в IndigoProfileAccount оставались орфанами).
  const accountIdsToCleanup = new Set<number>()
  if (existing.socialAccountId) accountIdsToCleanup.add(existing.socialAccountId)
  for (const a of existing.accounts) {
    accountIdsToCleanup.add(a.socialAccountId)
  }

  if (accountIdsToCleanup.size === 0) {
    // Уже отвязан полностью — идемпотентность.
    const fresh = await prisma.deviceProfile.findUnique({
      where: { id },
      include: {
        socialAccount: { include: { app: { select: { id: true, name: true } } } },
        proxy: {
          select: { id: true, label: true, status: true, type: true, expectedCountry: true },
        },
        accounts: {
          include: { socialAccount: { include: { app: { select: { id: true, name: true } } } } },
          orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
        },
      },
    })
    return { data: fresh ? toDeviceProfileDto(fresh) : null }
  }

  await prisma.$transaction(async (tx) => {
    // 1. Удаляем normalized записи привязки (включая возможных орфанов).
    await tx.deviceProfileAccount.deleteMany({
      where: { profileId: id },
    })
    // 2. Очищаем denorm на IndigoProfile.
    await tx.deviceProfile.update({
      where: { id },
      data: { socialAccountId: null },
    })
    // 3. Очищаем denorm на всех затронутых SocialAccount.
    await tx.socialAccount.updateMany({
      where: {
        id: { in: Array.from(accountIdsToCleanup) },
        deviceProfileId: id,
      },
      data: { deviceProfileId: null },
    })
  })

  const updated = await prisma.deviceProfile.findUnique({
    where: { id },
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
