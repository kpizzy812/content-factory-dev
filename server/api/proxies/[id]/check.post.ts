/**
 * POST /api/proxies/:id/check
 * Ручной запуск health-check прокси (TCP + HTTP probe + leak detection).
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
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

  const result = await runProxyHealthCheck(id, "manual")
  return { data: result }
})
