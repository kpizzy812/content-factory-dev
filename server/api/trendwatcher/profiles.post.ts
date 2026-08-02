/**
 * POST /api/trendwatcher/profiles
 * Создание нового профиля парсинга.
 */

const VALID_PLATFORMS = ["tiktok", "instagram", "youtube"] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "trendwatcher",
  })

  const body = await readBody<{
    appId?: number
    name?: string
    actorId?: string
    contentFormat?: string
    keywords?: string[]
    platforms?: string[]
    language?: string
    geo?: string
    viewCountMin?: number | null
    viewCountMax?: number | null
    maxItems?: number
    isInline?: boolean
    sourceNodeId?: string
    sourcePipelineId?: number
  }>(event)

  if (!body?.appId || typeof body.appId !== "number" || body.appId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'appId' обязательно и должно быть числом > 0",
    })
  }

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'name' обязательно",
    })
  }

  const app = await prisma.app.findUnique({ where: { id: body.appId } })
  if (!app) {
    throw createError({
      statusCode: 404,
      message: "Приложение не найдено",
    })
  }

  // Валидация platforms
  const platforms: string[] = []
  if (Array.isArray(body.platforms)) {
    for (const p of body.platforms) {
      if (VALID_PLATFORMS.includes(p as typeof VALID_PLATFORMS[number])) {
        platforms.push(p)
      }
    }
  }

  if (platforms.length === 0) {
    throw createError({
      statusCode: 400,
      message: "Необходимо указать хотя бы одну платформу",
    })
  }

  // Валидация keywords
  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((k) => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())
    : []

  const profile = await prisma.trendwatcherProfile.create({
    data: {
      appId: body.appId,
      name: body.name.trim(),
      actorId: body.actorId?.trim() || "clockworks/tiktok-scraper",
      // Неизвестное значение не роняет запрос, а откатывается к Reels —
      // вертикальный ролик и есть продукт фабрики.
      contentFormat: body.contentFormat === "posts" ? "posts" : "reels",
      keywords,
      platforms: platforms as Array<"tiktok" | "instagram" | "youtube">,
      language: body.language?.trim() || null,
      geo: body.geo?.trim() || null,
      viewCountMin: typeof body.viewCountMin === "number" ? body.viewCountMin : null,
      viewCountMax: typeof body.viewCountMax === "number" ? body.viewCountMax : null,
      maxItems: typeof body.maxItems === "number" && body.maxItems > 0 ? body.maxItems : 20,
      isInline: body.isInline === true,
      sourceNodeId: body.sourceNodeId?.trim() || null,
      sourcePipelineId: typeof body.sourcePipelineId === "number" ? body.sourcePipelineId : null,
    },
    include: {
      app: { select: { id: true, name: true } },
    },
  })

  return { data: profile }
})
