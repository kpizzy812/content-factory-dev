/**
 * DELETE /api/proxies/:id
 * Удаление прокси, если не привязан ни к одному аккаунту.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор прокси" })
  }

  const proxy = await prisma.proxy.findUnique({
    where: { id },
    include: { _count: { select: { socialAccounts: true } } },
  })

  if (!proxy) {
    throw createError({ statusCode: 404, message: "Прокси не найден" })
  }

  if (proxy._count.socialAccounts > 0) {
    throw createError({
      statusCode: 409,
      message: `Прокси привязан к ${proxy._count.socialAccounts} аккаунтам, отвяжите перед удалением`,
    })
  }

  await prisma.proxy.delete({ where: { id } })

  setResponseStatus(event, 204)
  return null
})
