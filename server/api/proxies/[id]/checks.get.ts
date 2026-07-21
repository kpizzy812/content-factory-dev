/**
 * GET /api/proxies/:id/checks
 * История проверок прокси (последние 50 записей по checkedAt desc).
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

  const proxy = await prisma.proxy.findUnique({ where: { id }, select: { id: true } })
  if (!proxy) {
    throw createError({ statusCode: 404, message: "Прокси не найден" })
  }

  const checks = await prisma.proxyHealthCheck.findMany({
    where: { proxyId: id },
    orderBy: { checkedAt: "desc" },
    take: 50,
  })

  return { data: checks.map(toProxyHealthCheckDto) }
})
