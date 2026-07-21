const VALID_STATUSES = ["new", "reviewed", "in_work", "completed", "dismissed"] as const

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canWrite'], moduleSlug: 'trendwatcher' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Invalid trend ID",
    })
  }

  const body = await readBody<{ status?: string }>(event)

  if (!body?.status || !VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
    throw createError({
      statusCode: 400,
      message: `Field 'status' must be one of: ${VALID_STATUSES.join(", ")}`,
    })
  }

  // Check that trend exists
  const existing = await prisma.trend.findUnique({ where: { id } })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: "Trend not found",
    })
  }

  const trend = await prisma.trend.update({
    where: { id },
    data: {
      status: body.status as typeof VALID_STATUSES[number],
    },
    include: {
      insights: true,
      app: true,
    },
  })

  return { data: trend }
})
