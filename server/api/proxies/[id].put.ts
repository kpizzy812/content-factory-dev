/**
 * PUT /api/proxies/:id
 * Частичное обновление прокси (валидация, шифрование изменённых секретов).
 */
import type { Prisma } from "~~/app/generated/prisma/client"
import type { ProxyUpdateInput, ProxyType } from "~~/shared/types/proxy"
import { PROXY_PROTOCOLS } from "~~/shared/types/proxy"

const VALID_TYPES: ProxyType[] = ["mobile", "residential", "datacenter"]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор прокси" })
  }

  const existing = await prisma.proxy.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Прокси не найден" })
  }

  const body = await readBody<ProxyUpdateInput>(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  const data: Prisma.ProxyUpdateInput = {}

  if (body.label !== undefined) {
    if (
      typeof body.label !== "string" ||
      !body.label.trim() ||
      body.label.length > 120
    ) {
      throw createError({
        statusCode: 400,
        message: "Поле 'label' должно быть непустой строкой до 120 символов",
      })
    }
    data.label = body.label.trim()
  }

  if (body.type !== undefined) {
    if (!VALID_TYPES.includes(body.type)) {
      throw createError({
        statusCode: 400,
        message: `Поле 'type' допускает: ${VALID_TYPES.join(", ")}`,
      })
    }
    data.type = body.type
  }

  if (body.protocol !== undefined) {
    if (!PROXY_PROTOCOLS.includes(body.protocol)) {
      throw createError({
        statusCode: 400,
        message: `Поле 'protocol' допускает: ${PROXY_PROTOCOLS.join(", ")}`,
      })
    }
    data.protocol = body.protocol
  }

  if (body.host !== undefined) {
    if (
      typeof body.host !== "string" ||
      !body.host.trim() ||
      body.host.length > 253
    ) {
      throw createError({
        statusCode: 400,
        message: "Поле 'host' должно быть непустой строкой до 253 символов",
      })
    }
    data.host = encryptSecret(body.host.trim())
  }

  if (body.port !== undefined) {
    if (
      typeof body.port !== "number" ||
      !Number.isFinite(body.port) ||
      body.port < 1 ||
      body.port > 65535
    ) {
      throw createError({
        statusCode: 400,
        message: "Поле 'port' должно быть числом 1..65535",
      })
    }
    data.port = body.port
  }

  // username/password — атомарная пара. Берём из присланного либо из существующего.
  const usernameProvided = "username" in body
  const passwordProvided = "password" in body
  if (usernameProvided || passwordProvided) {
    const nextUsernameRaw = usernameProvided ? body.username : null
    const nextPasswordRaw = passwordProvided ? body.password : null

    const nextHasUsername =
      usernameProvided
        ? typeof nextUsernameRaw === "string" && nextUsernameRaw.length > 0
        : !!existing.username
    const nextHasPassword =
      passwordProvided
        ? typeof nextPasswordRaw === "string" && nextPasswordRaw.length > 0
        : !!existing.password

    if (nextHasUsername !== nextHasPassword) {
      throw createError({
        statusCode: 400,
        message: "Поля 'username' и 'password' должны существовать вместе",
      })
    }

    if (usernameProvided) {
      data.username = nextHasUsername ? encryptSecret(nextUsernameRaw as string) : null
    }
    if (passwordProvided) {
      data.password = nextHasPassword ? encryptSecret(nextPasswordRaw as string) : null
    }
  }

  if ("rotationUrl" in body) {
    if (body.rotationUrl === null || body.rotationUrl === undefined || body.rotationUrl === "") {
      data.rotationUrl = null
    } else if (typeof body.rotationUrl !== "string") {
      throw createError({ statusCode: 400, message: "Поле 'rotationUrl' должно быть строкой" })
    } else {
      data.rotationUrl = encryptSecret(body.rotationUrl)
    }
  }

  if ("provider" in body) {
    if (body.provider === null || body.provider === undefined || body.provider === "") {
      data.provider = null
    } else if (typeof body.provider !== "string") {
      throw createError({ statusCode: 400, message: "Поле 'provider' должно быть строкой" })
    } else {
      data.provider = body.provider.trim()
    }
  }

  if ("expectedCountry" in body) {
    data.expectedCountry =
      body.expectedCountry && typeof body.expectedCountry === "string"
        ? body.expectedCountry.trim() || null
        : null
  }

  if ("expectedCity" in body) {
    data.expectedCity =
      body.expectedCity && typeof body.expectedCity === "string"
        ? body.expectedCity.trim() || null
        : null
  }

  if ("ipv4Only" in body) {
    if (typeof body.ipv4Only !== "boolean") {
      throw createError({ statusCode: 400, message: "Поле 'ipv4Only' должно быть boolean" })
    }
    data.ipv4Only = body.ipv4Only
  }

  if ("monthlyTrafficGB" in body) {
    if (body.monthlyTrafficGB === null || body.monthlyTrafficGB === undefined) {
      data.monthlyTrafficGB = null
    } else if (typeof body.monthlyTrafficGB !== "number" || !Number.isFinite(body.monthlyTrafficGB)) {
      throw createError({ statusCode: 400, message: "Поле 'monthlyTrafficGB' должно быть числом" })
    } else {
      data.monthlyTrafficGB = body.monthlyTrafficGB
    }
  }

  if ("expiresAt" in body) {
    if (!body.expiresAt) {
      data.expiresAt = null
    } else {
      const d = new Date(body.expiresAt)
      if (Number.isNaN(d.getTime())) {
        throw createError({ statusCode: 400, message: "Поле 'expiresAt' имеет неверный формат" })
      }
      data.expiresAt = d
    }
  }

  if ("notes" in body) {
    data.notes =
      body.notes && typeof body.notes === "string" ? body.notes.trim() || null : null
  }

  const updated = await prisma.proxy.update({
    where: { id },
    data,
    include: { _count: { select: { socialAccounts: true } } },
  })

  return { data: toProxyDto(updated, updated._count.socialAccounts) }
})
