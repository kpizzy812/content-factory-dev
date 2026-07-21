/**
 * GET /api/proxies
 * Список прокси с фильтрами по status/type и поиском по label/provider/expectedCountry.
 */
import type { Prisma } from "~~/app/generated/prisma/client"
import type { ProxyType, ProxyStatus } from "~~/shared/types/proxy"

const VALID_TYPES: ProxyType[] = ["mobile", "residential", "datacenter"]
const VALID_STATUSES: ProxyStatus[] = ["unverified", "healthy", "degraded", "dead", "expired"]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const query = getQuery(event)
  const where: Prisma.ProxyWhereInput = {}

  if (typeof query.status === "string" && VALID_STATUSES.includes(query.status as ProxyStatus)) {
    where.status = query.status as ProxyStatus
  }

  if (typeof query.type === "string" && VALID_TYPES.includes(query.type as ProxyType)) {
    where.type = query.type as ProxyType
  }

  if (typeof query.search === "string" && query.search.trim()) {
    const term = query.search.trim()
    where.OR = [
      { label: { contains: term, mode: "insensitive" } },
      { provider: { contains: term, mode: "insensitive" } },
      { expectedCountry: { contains: term, mode: "insensitive" } },
    ]
  }

  const proxies = await prisma.proxy.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { socialAccounts: true } } },
  })

  const data = proxies.map((p) => toProxyDto(p, p._count.socialAccounts))
  return { data }
})
