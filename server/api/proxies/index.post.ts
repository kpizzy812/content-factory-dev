/**
 * POST /api/proxies
 * Создание прокси с шифрованием host/username/password/rotationUrl.
 */
import type { ProxyCreateInput, ProxyProtocol, ProxyType } from "~~/shared/types/proxy"
import { PROXY_PROTOCOLS } from "~~/shared/types/proxy"

const VALID_TYPES: ProxyType[] = ["mobile", "residential", "datacenter"]

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "social-upload",
  })

  const body = await readBody<ProxyCreateInput>(event)

  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  // label
  if (
    typeof body.label !== "string" ||
    !body.label.trim() ||
    body.label.length > 120
  ) {
    throw createError({
      statusCode: 400,
      message: "Поле 'label' обязательно (строка до 120 символов)",
    })
  }

  // type
  if (!body.type || !VALID_TYPES.includes(body.type)) {
    throw createError({
      statusCode: 400,
      message: `Поле 'type' обязательно. Допустимые: ${VALID_TYPES.join(", ")}`,
    })
  }

  // protocol (опциональный, дефолт http)
  let protocol: ProxyProtocol = "http"
  if (body.protocol !== undefined && body.protocol !== null) {
    if (!PROXY_PROTOCOLS.includes(body.protocol)) {
      throw createError({
        statusCode: 400,
        message: `Поле 'protocol' должно быть одним из: ${PROXY_PROTOCOLS.join(", ")}`,
      })
    }
    protocol = body.protocol
  }

  // host
  if (
    typeof body.host !== "string" ||
    !body.host.trim() ||
    body.host.length > 253
  ) {
    throw createError({
      statusCode: 400,
      message: "Поле 'host' обязательно (строка до 253 символов)",
    })
  }

  // port
  if (
    typeof body.port !== "number" ||
    !Number.isFinite(body.port) ||
    body.port < 1 ||
    body.port > 65535
  ) {
    throw createError({
      statusCode: 400,
      message: "Поле 'port' обязательно (число в диапазоне 1..65535)",
    })
  }

  // username/password — оба или ни одного
  const hasUsername = typeof body.username === "string" && body.username.length > 0
  const hasPassword = typeof body.password === "string" && body.password.length > 0
  if (hasUsername !== hasPassword) {
    throw createError({
      statusCode: 400,
      message: "Поля 'username' и 'password' должны передаваться вместе",
    })
  }

  if (body.provider !== undefined && body.provider !== null && typeof body.provider !== "string") {
    throw createError({ statusCode: 400, message: "Поле 'provider' должно быть строкой" })
  }

  let expiresAt: Date | null = null
  if (body.expiresAt) {
    const d = new Date(body.expiresAt)
    if (Number.isNaN(d.getTime())) {
      throw createError({ statusCode: 400, message: "Поле 'expiresAt' имеет неверный формат" })
    }
    expiresAt = d
  }

  if (
    body.monthlyTrafficGB !== undefined &&
    body.monthlyTrafficGB !== null &&
    (typeof body.monthlyTrafficGB !== "number" || !Number.isFinite(body.monthlyTrafficGB))
  ) {
    throw createError({ statusCode: 400, message: "Поле 'monthlyTrafficGB' должно быть числом" })
  }

  const proxy = await prisma.proxy.create({
    data: {
      label: body.label.trim(),
      provider: body.provider?.trim() || null,
      type: body.type,
      protocol,
      host: encryptSecret(body.host.trim()),
      port: body.port,
      username: hasUsername ? encryptSecret(body.username as string) : null,
      password: hasPassword ? encryptSecret(body.password as string) : null,
      rotationUrl: body.rotationUrl ? encryptSecret(body.rotationUrl) : null,
      expectedCountry: body.expectedCountry?.trim() || null,
      expectedCity: body.expectedCity?.trim() || null,
      ipv4Only: body.ipv4Only === true,
      monthlyTrafficGB: body.monthlyTrafficGB ?? null,
      expiresAt,
      notes: body.notes?.trim() || null,
      createdById: user.id,
    },
  })

  setResponseStatus(event, 201)
  return { data: toProxyDto(proxy, 0) }
})
