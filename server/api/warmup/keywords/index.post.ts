/**
 * POST /api/warmup/keywords
 * Создание keyword pool. Требуется canAdmin.
 *
 * Body: name, appId?, language?, category, platform?, keywords[], hashtags?, isActive?
 */
import type { Platform } from "~~/app/generated/prisma/client"
import { toKeywordPoolDto } from "~~/server/utils/warmup/dto"
import { asStringArray } from "~~/server/utils/warmup/validation"

const ALL_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"]

interface CreateBody {
  name?: unknown
  appId?: unknown
  language?: unknown
  category?: unknown
  platform?: unknown
  keywords?: unknown
  hashtags?: unknown
  isActive?: unknown
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canAdmin"],
    moduleSlug: "social-upload",
  })

  const body = await readBody<CreateBody>(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    throw createError({ statusCode: 400, message: "Поле 'name' обязательно" })
  }
  const name = body.name.trim().slice(0, 200)

  if (typeof body.category !== "string" || !body.category.trim()) {
    throw createError({ statusCode: 400, message: "Поле 'category' обязательно" })
  }
  const category = body.category.trim().slice(0, 100)

  let appId: number | null = null
  if (body.appId !== undefined && body.appId !== null) {
    const n = Number(body.appId)
    if (!Number.isFinite(n) || n <= 0) {
      throw createError({ statusCode: 400, message: "Поле 'appId' должно быть положительным числом или null" })
    }
    appId = n
  }

  let language: string | null = null
  if (body.language !== undefined && body.language !== null) {
    if (typeof body.language !== "string") {
      throw createError({ statusCode: 400, message: "Поле 'language' должно быть строкой или null" })
    }
    const lang = body.language.trim().toLowerCase()
    language = lang || null
  }

  let platform: Platform | null = null
  if (body.platform !== undefined && body.platform !== null) {
    if (typeof body.platform !== "string" || !ALL_PLATFORMS.includes(body.platform as Platform)) {
      throw createError({
        statusCode: 400,
        message: `Поле 'platform' должно быть одним из: ${ALL_PLATFORMS.join(", ")} или null`,
      })
    }
    platform = body.platform as Platform
  }

  const keywords = asStringArray(body.keywords, "keywords")
  if (keywords.length === 0) {
    throw createError({ statusCode: 400, message: "keywords не может быть пустым" })
  }

  const hashtags = body.hashtags === undefined || body.hashtags === null
    ? []
    : asStringArray(body.hashtags, "hashtags")

  const isActive = body.isActive === undefined ? true : Boolean(body.isActive)

  const pool = await prisma.warmupKeywordPool.create({
    data: {
      name,
      appId,
      language,
      category,
      platform,
      keywords,
      hashtags,
      isActive,
      createdById: user.id,
    },
  })

  setResponseStatus(event, 201)
  return { data: toKeywordPoolDto(pool) }
})
