/**
 * PUT /api/trendwatcher/profiles/:id/schedule
 * Настройка расписания для профиля Trendwatcher.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "trendwatcher",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id профиля" })
  }

  const body = await readBody<{
    scheduleEnabled?: boolean
    scheduleCron?: string | null
    scheduleTimezone?: string
  }>(event)

  const profile = await prisma.trendwatcherProfile.findUnique({
    where: { id },
  })

  if (!profile) {
    throw createError({ statusCode: 404, message: "Профиль не найден" })
  }

  const data: Record<string, unknown> = {}

  if (typeof body.scheduleEnabled === "boolean") {
    data.scheduleEnabled = body.scheduleEnabled
  }

  if (body.scheduleCron !== undefined) {
    if (body.scheduleCron) {
      // Валидация cron
      if (!isValidCron(body.scheduleCron)) {
        throw createError({
          statusCode: 400,
          message: "Некорректное cron-выражение. Формат: '0 */6 * * *' (минуты часы дни месяц день_недели)",
        })
      }
      data.scheduleCron = body.scheduleCron
      data.scheduleNextRunAt = getNextRunTime(body.scheduleCron, new Date())
    } else {
      data.scheduleCron = null
      data.scheduleNextRunAt = null
    }
  }

  if (body.scheduleTimezone) {
    data.scheduleTimezone = body.scheduleTimezone
  }

  const updated = await prisma.trendwatcherProfile.update({
    where: { id },
    data,
    include: { app: { select: { id: true, name: true } } },
  })

  return { data: updated }
})

function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  // Базовая валидация: каждая часть содержит допустимые символы
  const pattern = /^[\d*,\-/]+$/
  return parts.every((p) => pattern.test(p))
}
