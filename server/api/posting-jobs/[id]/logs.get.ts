/**
 * GET /api/posting-jobs/:id/logs
 * Пагинированный список логов конкретного PostingJob.
 *
 * Query:
 *   limit: number (default 50, max 200)
 *   offset: number (default 0)
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор job" })
  }

  const job = await prisma.postingJob.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!job) {
    throw createError({ statusCode: 404, message: "PostingJob не найден" })
  }

  const query = getQuery(event)
  const limitRaw = Number(query.limit ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
  const offsetRaw = Number(query.offset ?? 0)
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  const [items, total] = await Promise.all([
    prisma.postingJobLog.findMany({
      where: { jobId: id },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.postingJobLog.count({ where: { jobId: id } }),
  ])

  return { items, total }
})
