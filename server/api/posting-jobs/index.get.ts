/**
 * GET /api/posting-jobs
 * Список PostingJob с фильтрами по статусу/платформе/аккаунту/диапазону дат + пагинация.
 *
 * Query:
 *   status: PostingJobStatus | PostingJobStatus[]
 *   platform: Platform
 *   socialAccountId: number
 *   from: ISO datetime — нижняя граница createdAt
 *   to: ISO datetime — верхняя граница createdAt
 *   limit: number (default 50, max 200)
 *   offset: number (default 0)
 */
import type { Platform, PostingJobStatus, Prisma } from "~~/app/generated/prisma/client"
import {
  loadDeviceContextMap,
  getPostingEngineMeta,
} from "~~/server/utils/posting/device-context"

const ALL_STATUSES: PostingJobStatus[] = [
  "scheduled",
  "queued",
  "preparing",
  "uploading",
  "published",
  "failed",
  "retry_queued",
  "cancelled",
]

const ALL_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"]

function parseStatusFilter(raw: unknown): PostingJobStatus[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : String(raw).split(",")
  const out: PostingJobStatus[] = []
  for (const item of arr) {
    const v = String(item).trim()
    if (ALL_STATUSES.includes(v as PostingJobStatus)) {
      out.push(v as PostingJobStatus)
    }
  }
  return out
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const query = getQuery(event)
  const where: Prisma.PostingJobWhereInput = {}

  const statuses = parseStatusFilter(query.status)
  if (statuses.length > 0) {
    where.status = { in: statuses }
  }

  if (typeof query.platform === "string" && ALL_PLATFORMS.includes(query.platform as Platform)) {
    where.platform = query.platform as Platform
  }

  if (query.socialAccountId !== undefined) {
    const id = Number(query.socialAccountId)
    if (Number.isFinite(id) && id > 0) {
      where.socialAccountId = id
    }
  }

  const createdAt: Prisma.DateTimeFilter = {}
  if (typeof query.from === "string") {
    const d = new Date(query.from)
    if (!Number.isNaN(d.getTime())) createdAt.gte = d
  }
  if (typeof query.to === "string") {
    const d = new Date(query.to)
    if (!Number.isNaN(d.getTime())) createdAt.lte = d
  }
  if (createdAt.gte || createdAt.lte) {
    where.createdAt = createdAt
  }

  const limitRaw = Number(query.limit ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
  const offsetRaw = Number(query.offset ?? 0)
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  const [items, total] = await Promise.all([
    prisma.postingJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        socialAccount: {
          select: {
            id: true,
            displayName: true,
            platform: true,
            status: true,
            // 1:1:1 anti-detect видимость на карточке: бейджи и proxy gating-alert.
            postingMethod: true,
            proxyId: true,
            deviceProfileId: true,
            proxy: {
              select: { id: true, label: true, status: true },
            },
          },
        },
        video: {
          select: { id: true, status: true, fileUrl: true },
        },
      },
    }),
    prisma.postingJob.count({ where }),
  ])

  // DuoPlus device-контекст: резолвим по SocialAccount.deviceProfileId (FK,
  // которым реально оперирует постинг) одним пакетным запросом. config не утекает
  // наружу — в DTO только { deviceProfileId, deviceName, deviceImageId, deviceStatus }.
  const deviceMap = await loadDeviceContextMap(
    items.map((j) => j.socialAccount?.deviceProfileId),
  )
  const itemsWithDevice = items.map((job) => {
    if (!job.socialAccount) return job
    const profileId = job.socialAccount.deviceProfileId
    return {
      ...job,
      socialAccount: {
        ...job.socialAccount,
        device: profileId ? deviceMap.get(profileId) ?? null : null,
      },
    }
  })

  return { items: itemsWithDevice, total, engine: getPostingEngineMeta() }
})
