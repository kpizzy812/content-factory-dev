/**
 * PUT /api/warmup/keywords/:id
 * Обновление keyword pool. Требуется canAdmin.
 *
 * Body: name?, appId?, language?, category?, platform?, keywords?, hashtags?, isActive?
 */
import type { Platform, Prisma } from "~~/app/generated/prisma/client"
import { toKeywordPoolDto } from "~~/server/utils/warmup/dto"
import { asStringArray } from "~~/server/utils/warmup/validation"

const ALL_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"]

interface UpdateBody {
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
  // Pools globally manageable by canAdmin (single-tenant assumption).
  // Если перейдём к multi-tenant, нужно будет проверять existing.appId vs user.currentAppId.
  await requireScopedAccess(event, {
    permissions: ["canAdmin"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор pool" })
  }

  const existing = await prisma.warmupKeywordPool.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: `WarmupKeywordPool ${id} не найден` })
  }

  const body = (await readBody<UpdateBody>(event)) ?? {}
  const data: Prisma.WarmupKeywordPoolUpdateInput = {}

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw createError({ statusCode: 400, message: "Поле 'name' должно быть непустой строкой" })
    }
    data.name = body.name.trim().slice(0, 200)
  }

  if (body.category !== undefined) {
    if (typeof body.category !== "string" || !body.category.trim()) {
      throw createError({ statusCode: 400, message: "Поле 'category' должно быть непустой строкой" })
    }
    data.category = body.category.trim().slice(0, 100)
  }

  if (body.appId !== undefined) {
    if (body.appId === null) {
      data.app = { disconnect: true }
    } else {
      const n = Number(body.appId)
      if (!Number.isFinite(n) || n <= 0) {
        throw createError({ statusCode: 400, message: "Поле 'appId' должно быть положительным числом или null" })
      }
      data.app = { connect: { id: n } }
    }
  }

  if (body.language !== undefined) {
    if (body.language === null) {
      data.language = null
    } else {
      if (typeof body.language !== "string") {
        throw createError({ statusCode: 400, message: "Поле 'language' должно быть строкой или null" })
      }
      const lang = body.language.trim().toLowerCase()
      data.language = lang || null
    }
  }

  if (body.platform !== undefined) {
    if (body.platform === null) {
      data.platform = null
    } else {
      if (typeof body.platform !== "string" || !ALL_PLATFORMS.includes(body.platform as Platform)) {
        throw createError({
          statusCode: 400,
          message: `Поле 'platform' должно быть одним из: ${ALL_PLATFORMS.join(", ")} или null`,
        })
      }
      data.platform = body.platform as Platform
    }
  }

  if (body.keywords !== undefined) {
    const arr = asStringArray(body.keywords, "keywords")
    if (arr.length === 0) {
      throw createError({ statusCode: 400, message: "keywords не может быть пустым" })
    }
    data.keywords = arr
  }

  if (body.hashtags !== undefined) {
    data.hashtags = asStringArray(body.hashtags, "hashtags")
  }

  if (body.isActive !== undefined) {
    data.isActive = Boolean(body.isActive)
  }

  const updated = await prisma.warmupKeywordPool.update({
    where: { id },
    data,
  })

  return { data: toKeywordPoolDto(updated) }
})
