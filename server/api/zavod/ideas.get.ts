import { mapIdeaToExportPayload } from "../../utils/idea-sync"

export default defineEventHandler(async (event) => {
  requireZavodAuth(event)

  const query = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50))
  const offset = Math.max(0, Number(query.offset) || 0)

  const where: Record<string, unknown> = { isDeleted: false }

  const rawAppId = query.appId ? Number(query.appId) : undefined
  if (rawAppId && !Number.isNaN(rawAppId)) {
    const app = await prisma.app.findUnique({ where: { externalId: rawAppId } })
    if (!app) {
      return { data: [], meta: { total: 0, limit, offset } }
    }
    where.appId = app.id
  }

  if (query.status && typeof query.status === "string") {
    where.status = query.status
  }

  const [ideas, total] = await Promise.all([
    prisma.idea.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      include: {
        app: { select: { id: true, externalId: true, name: true } },
      },
    }),
    prisma.idea.count({ where }),
  ])

  const data = ideas.map((idea) => {
    const payload = mapIdeaToExportPayload(idea)
    return {
      ...payload,
      id: idea.id,
      appExternalId: idea.app?.externalId ?? null,
      status: idea.status,
      createdAt: idea.createdAt.toISOString(),
      updatedAt: idea.updatedAt.toISOString(),
    }
  })

  return { data, meta: { total, limit, offset } }
})
