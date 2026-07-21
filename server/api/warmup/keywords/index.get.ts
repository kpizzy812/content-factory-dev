/**
 * GET /api/warmup/keywords
 * Список keyword pools с фильтрами.
 *
 * Query:
 *   appId: number — фильтр по приложению (или 'global' для appId IS NULL)
 *   language: 'ru' | 'en' | 'null'
 *   category: string
 *   platform: tiktok | instagram | youtube
 *   isActive: boolean
 *   limit: number (default 100, max 500)
 *   offset: number (default 0)
 */
import type { Platform, Prisma } from "~~/app/generated/prisma/client"
import { toKeywordPoolDto } from "~~/server/utils/warmup/dto"

const ALL_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const query = getQuery(event)
  const where: Prisma.WarmupKeywordPoolWhereInput = {}

  if (query.appId !== undefined) {
    if (String(query.appId) === "global") {
      where.appId = null
    } else {
      const id = Number(query.appId)
      if (Number.isFinite(id) && id > 0) where.appId = id
    }
  }

  if (typeof query.language === "string") {
    if (query.language === "null") {
      where.language = null
    } else {
      where.language = query.language
    }
  }

  if (typeof query.category === "string" && query.category.trim()) {
    where.category = query.category.trim()
  }

  if (typeof query.platform === "string" && ALL_PLATFORMS.includes(query.platform as Platform)) {
    where.platform = query.platform as Platform
  }

  if (typeof query.isActive === "string") {
    where.isActive = query.isActive === "true"
  }

  const limitRaw = Number(query.limit ?? 100)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100
  const offsetRaw = Number(query.offset ?? 0)
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  const [items, total] = await Promise.all([
    prisma.warmupKeywordPool.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: limit,
      skip: offset,
    }),
    prisma.warmupKeywordPool.count({ where }),
  ])

  return {
    items: items.map(toKeywordPoolDto),
    total,
  }
})
