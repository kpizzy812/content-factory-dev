/**
 * GET /api/accounts/proxy-occupancy?proxyId=&deviceProfileId=&excludeAccountId=
 *
 * Lightweight read-only проверка 1:1:1 для UI-предупреждения: занят ли заданный
 * прокси и/или device-профиль ДРУГИМ browser_automation-аккаунтом.
 *
 * Ничего не меняет. Возвращает структуру с occupied-флагами и инфой об
 * аккаунте-владельце (для дружелюбного warning в AccountEditModal).
 *
 * api-аккаунты НЕ учитываются (для них шеринг прокси легитимен) — фильтр
 * жёстко postingMethod='browser_automation'.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const query = getQuery(event)

  const proxyId =
    typeof query.proxyId === "string" && query.proxyId.trim() ? query.proxyId.trim() : null
  const deviceProfileId =
    typeof query.deviceProfileId === "string" && query.deviceProfileId.trim()
      ? query.deviceProfileId.trim()
      : null

  const excludeRaw = query.excludeAccountId
  const excludeAccountId =
    excludeRaw !== undefined && excludeRaw !== null && Number(excludeRaw) > 0
      ? Number(excludeRaw)
      : null

  if (!proxyId && !deviceProfileId) {
    throw createError({
      statusCode: 400,
      message: "Нужен хотя бы один параметр: proxyId или deviceProfileId",
    })
  }

  const notSelf = excludeAccountId ? { id: { not: excludeAccountId } } : {}

  const [proxyOccupant, deviceOccupant] = await Promise.all([
    proxyId
      ? prisma.socialAccount.findFirst({
          where: { ...notSelf, proxyId, postingMethod: "browser_automation" },
          select: { id: true, displayName: true, platform: true },
        })
      : Promise.resolve(null),
    deviceProfileId
      ? prisma.socialAccount.findFirst({
          where: { ...notSelf, deviceProfileId, postingMethod: "browser_automation" },
          select: { id: true, displayName: true, platform: true },
        })
      : Promise.resolve(null),
  ])

  return {
    data: {
      proxy: proxyId
        ? {
            occupied: Boolean(proxyOccupant),
            occupiedBy: proxyOccupant
              ? {
                  accountId: proxyOccupant.id,
                  displayName: proxyOccupant.displayName,
                  platform: proxyOccupant.platform,
                }
              : null,
          }
        : null,
      deviceProfile: deviceProfileId
        ? {
            occupied: Boolean(deviceOccupant),
            occupiedBy: deviceOccupant
              ? {
                  accountId: deviceOccupant.id,
                  displayName: deviceOccupant.displayName,
                  platform: deviceOccupant.platform,
                }
              : null,
          }
        : null,
    },
  }
})
