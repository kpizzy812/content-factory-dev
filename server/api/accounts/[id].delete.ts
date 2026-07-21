/**
 * DELETE /api/accounts/:id
 * Отвязать (удалить) социальный аккаунт.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canDelete'], moduleSlug: 'social-upload' })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Неверный ID аккаунта",
    })
  }

  // Проверить существование
  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true, displayName: true },
  })

  if (!account) {
    throw createError({
      statusCode: 404,
      message: "Аккаунт не найден",
    })
  }

  // Проверить наличие активных загрузок
  const activeUploads = await prisma.upload.count({
    where: {
      socialAccountId: id,
      status: { in: ["pending", "uploading", "scheduled"] },
    },
  })

  if (activeUploads > 0) {
    throw createError({
      statusCode: 409,
      message: `Невозможно удалить аккаунт: ${activeUploads} активных загрузок`,
    })
  }

  await prisma.socialAccount.delete({ where: { id } })

  return { data: { id, deleted: true } }
})
