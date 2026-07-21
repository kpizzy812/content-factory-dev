/**
 * DELETE /api/trendwatcher/runs/:id
 * Отмена активного запуска. Устанавливает status=canceled.
 * Если запуск уже завершён — возвращает ошибку.
 */

const ACTIVE_STATUSES = ["pending", "starting", "running", "importing"]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "trendwatcher",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id запуска" })
  }

  const run = await prisma.trendwatcherRun.findUnique({
    where: { id },
    select: { id: true, status: true, profileId: true, externalRunId: true },
  })

  if (!run) {
    throw createError({ statusCode: 404, message: "Запуск не найден" })
  }

  if (!ACTIVE_STATUSES.includes(run.status)) {
    throw createError({
      statusCode: 400,
      message: `Запуск уже завершён (статус: ${run.status}). Отмена невозможна.`,
    })
  }

  // Попробуем отменить run на стороне Apify
  let apifyAborted = false
  if (run.externalRunId) {
    apifyAborted = await abortApifyRun(run.externalRunId)
  }

  await prisma.trendwatcherRun.update({
    where: { id },
    data: {
      status: "canceled",
      canceledAt: new Date(),
      errorCategory: "canceled",
      errorStep: "canceled",
      errorSummary: apifyAborted
        ? "Запуск отменён оператором, Apify run остановлен"
        : run.externalRunId
          ? "Запуск отменён локально. Apify run может ещё выполняться на стороне Apify"
          : "Запуск отменён оператором",
      canRetry: true,
    },
  })

  await prisma.trendwatcherRunLog.create({
    data: {
      runId: id,
      level: "warn",
      message: apifyAborted
        ? "Запуск отменён оператором. Apify run успешно остановлен"
        : "Запуск отменён оператором" + (run.externalRunId ? ". Внешний Apify run может продолжаться" : ""),
      step: "canceled",
    },
  })

  return {
    data: { id, status: "canceled", apifyAborted },
  }
})
