/**
 * POST /api/warmup/accounts/:accountId/schedule
 * Создание warmup-сессии (status=planned) для аккаунта.
 *
 * Body:
 *   scheduledAt: ISO datetime (опц., default — сейчас)
 *   targetDurationMinutes: number 1..120 (опц.)
 *   replace: boolean — при наличии planned/cancelled на тот же dayKey пересоздаём
 *
 * 409 если есть planned/running на эту дату и replace !== true.
 */
import { toSessionDto } from "~~/server/utils/warmup/dto"

interface ScheduleBody {
  scheduledAt?: unknown
  targetDurationMinutes?: unknown
  replace?: unknown
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "social-upload",
  })

  const accountIdParam = getRouterParam(event, "accountId")
  const accountId = Number(accountIdParam)
  if (!Number.isFinite(accountId) || accountId <= 0) {
    throw createError({ statusCode: 400, message: "Неверный accountId" })
  }

  const body = (await readBody<ScheduleBody>(event).catch(() => ({}))) ?? {}

  let scheduledAt: Date | undefined
  if (body.scheduledAt !== undefined && body.scheduledAt !== null) {
    if (typeof body.scheduledAt !== "string") {
      throw createError({ statusCode: 400, message: "Поле 'scheduledAt' должно быть ISO-строкой" })
    }
    const d = new Date(body.scheduledAt)
    if (Number.isNaN(d.getTime())) {
      throw createError({ statusCode: 400, message: "Поле 'scheduledAt' имеет неверный формат" })
    }
    scheduledAt = d
  }

  let targetDurationMinutes: number | undefined
  if (body.targetDurationMinutes !== undefined && body.targetDurationMinutes !== null) {
    const n = Number(body.targetDurationMinutes)
    if (!Number.isFinite(n) || n < 1 || n > 120) {
      throw createError({
        statusCode: 400,
        message: "Поле 'targetDurationMinutes' должно быть от 1 до 120",
      })
    }
    targetDurationMinutes = n
  }

  const replace = body.replace === true

  const session = await createSessionForAccount({
    socialAccountId: accountId,
    scheduledAt,
    targetDurationMinutes,
    replace,
    createdById: user.id,
  })

  setResponseStatus(event, 201)
  return { data: toSessionDto(session) }
})
