/**
 * PUT /api/account-groups/:id
 * Обновить пачку: название и/или состав аккаунтов.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canWrite'], moduleSlug: 'social-upload' })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Неверный ID группы",
    })
  }

  const body = await readBody<{
    name?: string
    accountIds?: number[]
    dispatchMode?: string
  }>(event)

  // Проверить существование
  const existing = await prisma.accountGroup.findUnique({
    where: { id },
    select: { id: true },
  })

  if (!existing) {
    throw createError({ statusCode: 404, message: "Группа не найдена" })
  }

  const VALID_DISPATCH = ["round_robin", "all", "first_active"] as const
  const updateData: Record<string, unknown> = {}
  if (body?.name && typeof body.name === "string" && body.name.trim()) {
    updateData.name = body.name.trim()
  }
  if (body?.dispatchMode && VALID_DISPATCH.includes(body.dispatchMode as typeof VALID_DISPATCH[number])) {
    updateData.dispatchMode = body.dispatchMode
  }
  if (Object.keys(updateData).length > 0) {
    await prisma.accountGroup.update({ where: { id }, data: updateData })
  }

  // Обновить состав: удалить старых, добавить новых
  if (body?.accountIds && Array.isArray(body.accountIds)) {
    // Удалить всех текущих участников
    await prisma.accountGroupMember.deleteMany({
      where: { groupId: id },
    })

    // Добавить новых
    if (body.accountIds.length > 0) {
      await prisma.accountGroupMember.createMany({
        data: body.accountIds.map((accountId) => ({
          groupId: id,
          socialAccountId: accountId,
        })),
        skipDuplicates: true,
      })
    }
  }

  // Вернуть обновленную группу
  const group = await prisma.accountGroup.findUnique({
    where: { id },
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
