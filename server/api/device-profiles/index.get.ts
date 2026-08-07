/**
 * GET /api/device-profiles
 * Список Indigo-профилей с фильтрами по syncStatus / proxyId / socialAccountId / search.
 */
import type { Prisma } from "~~/app/generated/prisma/client"
import type { DeviceSyncStatus } from "~~/shared/types/device-profile"
import { DEVICE_SYNC_STATUSES } from "~~/shared/types/device-profile"
import { toDeviceProfileDto } from "~~/server/utils/posting-provider/dto"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const query = getQuery(event)
  const where: Prisma.DeviceProfileWhereInput = {}

  if (
    typeof query.syncStatus === "string"
    && DEVICE_SYNC_STATUSES.includes(query.syncStatus as DeviceSyncStatus)
  ) {
    // Explicit фильтр включая archived (для admin / audit просмотра).
    where.syncStatus = query.syncStatus as DeviceSyncStatus
  } else {
    // Default - скрываем archived (soft-deleted записи). Оператор увидит их
    // только через явный ?syncStatus=archived фильтр.
    where.syncStatus = { not: "archived" }
  }

  if (typeof query.proxyId === "string" && query.proxyId.trim()) {
    where.proxyId = query.proxyId.trim()
  }

  if (typeof query.socialAccountId === "string") {
    const accountId = Number(query.socialAccountId)
    if (Number.isFinite(accountId) && accountId > 0) {
      // После M.1: socialAccountId — primary indicator (denorm). Чтобы фильтр находил
      // профиль если account привязан как non-primary тоже — ищем через accounts join.
      where.OR = [
        ...(where.OR ?? []),
        { socialAccountId: accountId },
        { accounts: { some: { socialAccountId: accountId } } },
      ]
    }
  }

  if (typeof query.search === "string" && query.search.trim()) {
    const term = query.search.trim()
    const searchConditions: Prisma.DeviceProfileWhereInput[] = [
      { name: { contains: term, mode: "insensitive" } },
      { tags: { has: term } },
      { notes: { contains: term, mode: "insensitive" } },
    ]
    // P1: если уже есть OR от socialAccountId filter — комбинируем через AND-обёртку,
    // чтобы оба фильтра применялись. Простой merge `where.OR = [...where.OR, ...search]`
    // не подойдёт — он расширит первый блок, и search-term матчился бы даже на профили
    // без socialAccountId. Нужна логика: (socialAccountId.OR) AND (search.OR).
    if (where.OR) {
      const existingOr = where.OR
      where.AND = [
        ...((Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [])),
        { OR: existingOr },
        { OR: searchConditions },
      ]
      delete where.OR
    } else {
      where.OR = searchConditions
    }
  }

  // Пагинация — только по явной просьбе: этот же список читают пикеры
  // профиля в карточке аккаунта, и обрезать им выборку нельзя.
  const wantsPages = query.page !== undefined || query.perPage !== undefined
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 24))

  const total = await prisma.deviceProfile.count({ where })

  const rows = await prisma.deviceProfile.findMany({
    where,
    ...(wantsPages ? { skip: (page - 1) * perPage, take: perPage } : {}),
    orderBy: { createdAt: "desc" },
    include: {
      socialAccount: { include: { app: { select: { id: true, name: true } } } },
      proxy: { select: { id: true, label: true, status: true, type: true, expectedCountry: true } },
      accounts: {
        include: { socialAccount: { include: { app: { select: { id: true, name: true } } } } },
        orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
      },
    },
  })

  return {
    data: rows.map(toDeviceProfileDto),
    meta: {
      total,
      page: wantsPages ? page : 1,
      perPage: wantsPages ? perPage : total,
      totalPages: wantsPages ? Math.max(1, Math.ceil(total / perPage)) : 1,
    },
  }
})
