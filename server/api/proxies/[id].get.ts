/**
 * GET /api/proxies/:id
 * Детальный просмотр прокси без расшифровки секретов.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
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

  return { data: toProxyDto(proxy, proxy._count.socialAccounts) }
})
