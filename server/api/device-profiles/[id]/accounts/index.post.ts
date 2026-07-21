/**
 * POST /api/device-profiles/:id/accounts
 *
 * Привязка SocialAccount к IndigoProfile (1:1:1 модель — один профиль = один аккаунт).
 *
 * Body: { socialAccountId: number }
 *   isPrimary игнорируется (при 1:1:1 единственный аккаунт всегда primary).
 *
 * Errors:
 *   400 — невалидное тело / id.
 *   404 — профиль / аккаунт не найден.
 *   409 profile_occupied — у профиля уже есть привязанный аккаунт (1:1 enforcement).
 *   409 account_already_linked — этот аккаунт уже привязан к ДРУГОМУ профилю.
 *   412 PRECONDITION_FAILED — US-proxy guard fail (см. us-proxy-guard.ts).
 *
 * Permissions: canWrite + module social-upload + profile ownership.
 */

import { toDeviceProfileDto } from "~~/server/utils/posting-provider/dto"
import { assertUsProxyGuard } from "~~/server/utils/posting-provider/us-proxy-guard"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  // Tenant isolation. Возвращает базовый профиль без relations.
  await requireProfileOwnership(id, user)

  const body = await readBody<{ socialAccountId?: unknown }>(event)
  const accountId = Number(body?.socialAccountId)
  if (!Number.isFinite(accountId) || accountId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'socialAccountId' обязательно (положительное число)",
    })
  }

  // Pre-fetch profile + proxy для US-guard. proxy.expectedCountry проверяется server-side.
  const profile = await prisma.deviceProfile.findUnique({
    where: { id: id as string },
    select: {
      id: true,
      platformType: true,
      proxy: { select: { id: true, expectedCountry: true } },
    },
  })
  if (!profile) {
    throw createError({ statusCode: 404, message: "Indigo-профиль не найден" })
  }

  // US-proxy guard (M.4). Throws 412 если не US. Для DuoPlus (mobile_android) —
  // bypass: прокси на стороне устройства, US-проверка ZC-прокси избыточна.
  assertUsProxyGuard({
    profileId: profile.id,
    proxy: profile.proxy,
    platformType: profile.platformType,
  })

  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    select: { id: true, appId: true },
  })
  if (!account) {
    throw createError({ statusCode: 404, message: "Социальный аккаунт не найден" })
  }

  // P1 tenant-isolation: non-admin должен иметь доступ к App, к которому принадлежит
  // SocialAccount (через UserAppAssignment с accessLevel != none). Семантика admin
  // bypass соответствует CLAUDE.md / rbac.ts.
  if (!user.canAdmin) {
    const canAccessAccountApp = user.appAssignments.some(
      (a) => a.appId === account.appId && a.accessLevel !== "none",
    )
    if (!canAccessAccountApp) {
      throw createError({
        statusCode: 403,
        message: "Нет доступа к этому социальному аккаунту",
      })
    }
  }

  // 1:1:1 enforcement A: у профиля уже есть привязанный аккаунт?
  const profileOccupant = await prisma.deviceProfileAccount.findUnique({
    where: { profileId: profile.id },
    select: { socialAccountId: true },
  })
  if (profileOccupant) {
    // Same account → no-op идемпотентность (возвращаем актуальный DTO).
    if (profileOccupant.socialAccountId === accountId) {
      const current = await prisma.deviceProfile.findUnique({
        where: { id: profile.id },
        include: {
          socialAccount: { include: { app: { select: { id: true, name: true } } } },
          proxy: { select: { id: true, label: true, status: true, type: true, expectedCountry: true } },
          accounts: {
            include: { socialAccount: { include: { app: { select: { id: true, name: true } } } } },
            orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
          },
        },
      })
      setResponseStatus(event, 200)
      return { data: current ? toDeviceProfileDto(current) : null }
    }
    throw createError({
      statusCode: 409,
      statusMessage: "profile_occupied",
      data: {
        code: "profile_occupied",
        message: "Профиль уже привязан к аккаунту. Один профиль = один аккаунт (1:1:1).",
        profileId: profile.id,
        existingAccountId: profileOccupant.socialAccountId,
        suggestion: "Отвяжите текущий аккаунт или используйте другой свободный профиль.",
      },
    })
  }

  // 1:1:1 enforcement B: этот аккаунт уже привязан к другому профилю?
  //
  // Self-healing для legacy состояния "наполовину отвязан": если в БД остались
  // записи DeviceProfileAccount после прошлой версии unlink-account.post.ts
  // (она чистила только denorm поля), а SocialAccount.deviceProfileId уже null —
  // это орфан, удаляем и продолжаем привязку. Если же denorm согласован
  // (SocialAccount.deviceProfileId === существующий profileId), реальная привязка
  // есть → 409 с подсказкой отвязать.
  const accountElsewhereRows = await prisma.deviceProfileAccount.findMany({
    where: { socialAccountId: accountId },
    select: { profileId: true },
  })

  if (accountElsewhereRows.length > 0) {
    const accountDenorm = await prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: { deviceProfileId: true },
    })
    const denormProfileId = accountDenorm?.deviceProfileId ?? null

    // Орфаны = строки в IndigoProfileAccount где profileId не совпадает с denorm
    // (denorm null → все строки орфаны; denorm !== null → строки с другим profileId
    // орфаны, строка с denorm profileId — реальная привязка).
    const orphanProfileIds = accountElsewhereRows
      .map((r) => r.profileId)
      .filter((pid) => pid !== denormProfileId)

    if (orphanProfileIds.length > 0) {
      await prisma.deviceProfileAccount.deleteMany({
        where: {
          socialAccountId: accountId,
          profileId: { in: orphanProfileIds },
        },
      })
      // Также чистим denorm на профилях-орфанах (где socialAccountId указывает
      // на этот аккаунт). Это финальная синхронизация состояния.
      await prisma.deviceProfile.updateMany({
        where: {
          id: { in: orphanProfileIds },
          socialAccountId: accountId,
        },
        data: { socialAccountId: null },
      })
    }

    // Если осталась согласованная (не орфан) привязка к ДРУГОМУ профилю — 409.
    if (denormProfileId && denormProfileId !== profile.id) {
      throw createError({
        statusCode: 409,
        statusMessage: "account_already_linked",
        data: {
          code: "account_already_linked",
          message: "Аккаунт уже привязан к другому Indigo-профилю.",
          accountId,
          existingProfileId: denormProfileId,
          suggestion: "Отвяжите аккаунт от предыдущего профиля перед привязкой к этому.",
        },
      })
    }
  }

  // 1:1:1: единственный аккаунт всегда primary, denorm обновляется атомарно.
  await prisma.$transaction(async (tx) => {
    await tx.deviceProfileAccount.create({
      data: {
        profileId: profile.id,
        socialAccountId: accountId,
        isPrimary: true,
        addedById: user.id,
      },
    })
    await tx.deviceProfile.update({
      where: { id: profile.id },
      data: { socialAccountId: accountId },
    })
    await tx.socialAccount.update({
      where: { id: accountId },
      data: { deviceProfileId: profile.id },
    })
  })

  const updated = await prisma.deviceProfile.findUnique({
    where: { id: profile.id },
    include: {
      socialAccount: { include: { app: { select: { id: true, name: true } } } },
      proxy: { select: { id: true, label: true, status: true, type: true, expectedCountry: true } },
      accounts: {
        include: { socialAccount: { include: { app: { select: { id: true, name: true } } } } },
        orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
      },
    },
  })

  setResponseStatus(event, 201)
  return { data: updated ? toDeviceProfileDto(updated) : null }
})
