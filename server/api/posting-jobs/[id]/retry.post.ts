/**
 * POST /api/posting-jobs/:id/retry
 *
 * Manual retry: переключает PostingJob из failed в retry_queued.
 * Сбрасывает attemptCount=0 и retryAt=now (берётся на следующем тике worker'а).
 *
 * Только из failed. Из других статусов — 409 (используйте cancel + create новый).
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор job" })
  }

  const job = await prisma.postingJob.findUnique({
    where: { id },
    select: { id: true, status: true },
  })
  if (!job) {
    throw createError({ statusCode: 404, message: "PostingJob не найден" })
  }

  if (job.status !== "failed") {
    throw createError({
      statusCode: 409,
      message: `Manual retry допустим только для failed. Текущий статус: ${job.status}`,
    })
  }

  const updated = await transitionJob(id, "retry_queued", {
    attemptCount: 0,
    retryAt: new Date(),
    lastError: null,
    errorCategory: null,
  })

  await appendJobLog(id, "info", "Manual retry запрошен оператором", {
    actorId: user.id,
  })

  return { data: updated }
})
