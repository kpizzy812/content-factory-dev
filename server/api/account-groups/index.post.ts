/**
 * POST /api/account-groups
 * Создать пачку аккаунтов.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canCreate'], moduleSlug: 'social-upload' })

  const body = await readBody<{
    appId?: number
    name?: string
    accountIds?: number[]
    dispatchMode?: string
  }>(event)

  const VALID_DISPATCH = ["round_robin", "all", "first_active"] as const
  const dispatchMode = body?.dispatchMode && VALID_DISPATCH.includes(body.dispatchMode as typeof VALID_DISPATCH[number])
    ? body.dispatchMode
    : "round_robin"

  // Валидация
  if (!body?.appId || typeof body.appId !== "number" || body.appId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'appId' обязательно и должно быть числом > 0",
    })
  }

  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    throw createError({
      statusCode: 400,
      message: "Поле 'name' обязательно",
    })
  }

  // Проверить App
  const app = await prisma.app.findUnique({ where: { id: body.appId } })
  if (!app) {
    throw createError({ statusCode: 404, message: "Приложение не найдено" })
  }

  // Создать группу с участниками
  const group = await prisma.accountGroup.create({
    data: {
      appId: body.appId,
      name: body.name.trim(),
      dispatchMode,
      members: body.accountIds?.length
        ? {
            create: body.accountIds.map((accountId) => ({
              socialAccountId: accountId,
            })),
          }
        : undefined,
    },
    include: {
      members: {
        include: {
          socialAccount: {
            select: {
              id: true,
              platform: true,
              displayName: true,
              status: true,
            },
          },
        },
      },
    },
  })

  return { data: group }
})
