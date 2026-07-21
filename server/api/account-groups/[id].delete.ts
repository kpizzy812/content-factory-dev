/**
 * DELETE /api/account-groups/:id
 * Удалить пачку аккаунтов. Сами аккаунты не удаляются.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canDelete'], moduleSlug: 'social-upload' })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Неверный ID группы",
    })
  }

  const group = await prisma.accountGroup.findUnique({
    where: { id },
    select: { id: true },
  })

  if (!group) {
    throw createError({ statusCode: 404, message: "Группа не найдена" })
  }

  await prisma.accountGroup.delete({ where: { id } })

  return { data: { id, deleted: true } }
})
