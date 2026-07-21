/**
 * PUT /api/trendwatcher/profiles/:id
 * Обновление профиля парсинга.
 */

const VALID_PLATFORMS = ["tiktok", "instagram", "youtube"] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "trendwatcher",
  })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Некорректный ID профиля",
    })
  }

  const existing = await prisma.trendwatcherProfile.findUnique({ where: { id } })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: "Профиль парсинга не найден",
    })
  }

  const body = await readBody<{
    name?: string
    actorId?: string
    keywords?: string[]
    platforms?: string[]
    language?: string | null
    geo?: string | null
    enabled?: boolean
    viewCountMin?: number | null
    viewCountMax?: number | null
    maxItems?: number
  }>(event)

  if (!body || typeof body !== "object") {
    throw createError({
      statusCode: 400,
      message: "Тело запроса обязательно",
    })
  }

  const data: Record<string, unknown> = {}

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw createError({ statusCode: 400, message: "Имя не может быть пустым" })
    }
    data.name = body.name.trim()
  }

  if (body.actorId !== undefined) {
    data.actorId = typeof body.actorId === "string" ? body.actorId.trim() : existing.actorId
  }

  if (body.keywords !== undefined) {
    data.keywords = Array.isArray(body.keywords)
      ? body.keywords.filter((k) => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())
      : existing.keywords
  }

  if (body.platforms !== undefined) {
    const valid = Array.isArray(body.platforms)
      ? body.platforms.filter((p) => VALID_PLATFORMS.includes(p as typeof VALID_PLATFORMS[number]))
      : []
    if (valid.length === 0) {
      throw createError({ statusCode: 400, message: "Необходимо указать хотя бы одну платформу" })
    }
    data.platforms = valid
  }

  if (body.language !== undefined) {
    data.language = typeof body.language === "string" ? body.language.trim() || null : null
  }

  if (body.geo !== undefined) {
    data.geo = typeof body.geo === "string" ? body.geo.trim() || null : null
  }

  if (body.enabled !== undefined) {
    data.enabled = Boolean(body.enabled)
  }

  if (body.viewCountMin !== undefined) {
    data.viewCountMin = typeof body.viewCountMin === "number" ? body.viewCountMin : null
  }

  if (body.viewCountMax !== undefined) {
    data.viewCountMax = typeof body.viewCountMax === "number" ? body.viewCountMax : null
  }

  if (body.maxItems !== undefined && typeof body.maxItems === "number" && body.maxItems > 0) {
    data.maxItems = body.maxItems
  }

  if (Object.keys(data).length === 0) {
    throw createError({
      statusCode: 400,
      message: "Необходимо указать хотя бы одно поле для обновления",
    })
  }

  const profile = await prisma.trendwatcherProfile.update({
    where: { id },
    data,
    include: {
      app: { select: { id: true, name: true } },
    },
  })

  return { data: profile }
})
