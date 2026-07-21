/**
 * POST /api/proxies/:id/reveal
 * Расшифровка credentials прокси с обязательным audit-логом причины.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор прокси" })
  }

  const body = await readBody<{ reason?: string }>(event)
  const reason = typeof body?.reason === "string" ? body.reason.trim() : ""
  if (reason.length < 10 || reason.length > 500) {
    throw createError({
      statusCode: 400,
      message: "Укажите причину доступа (минимум 10 символов)",
    })
  }

  const proxy = await prisma.proxy.findUnique({ where: { id } })
  if (!proxy) {
    throw createError({ statusCode: 404, message: "Прокси не найден" })
  }

  const ctx = buildSecretAccessContext(event, user, reason)

  const host = await readSecret(
    proxy.host,
    { entityType: "Proxy.host", entityId: proxy.id, action: "view" },
    ctx,
  )
  const username = await readSecret(
    proxy.username,
    { entityType: "Proxy.username", entityId: proxy.id, action: "view" },
    ctx,
  )
  const password = await readSecret(
    proxy.password,
    { entityType: "Proxy.password", entityId: proxy.id, action: "view" },
    ctx,
  )
  const rotationUrl = await readSecret(
    proxy.rotationUrl,
    { entityType: "Proxy.rotationUrl", entityId: proxy.id, action: "view" },
    ctx,
  )

  const formatted = [host, String(proxy.port), username, password]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(":")

  return {
    data: {
      host,
      port: proxy.port,
      username,
      password,
      rotationUrl,
      formatted,
    },
  }
})
