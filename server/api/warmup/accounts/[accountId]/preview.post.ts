/**
 * POST /api/warmup/accounts/:accountId/preview
 * Dry-run генерация плана прогрева — БЕЗ сохранения в БД.
 *
 * Body:
 *   scheduledAt: ISO datetime (опц., default — сейчас)
 *   targetDurationMinutes: number 1..120 (опц., если не задан — берётся по бакету)
 *
 * Возвращает: { data: { plan, dayKey, seed, ageBucket } }
 */
interface PreviewBody {
  scheduledAt?: unknown
  targetDurationMinutes?: unknown
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const accountIdParam = getRouterParam(event, "accountId")
  const accountId = Number(accountIdParam)
  if (!Number.isFinite(accountId) || accountId <= 0) {
    throw createError({ statusCode: 400, message: "Неверный accountId" })
  }

  const body = (await readBody<PreviewBody>(event).catch(() => ({}))) ?? {}

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

  const result = await previewSessionForAccount({
    socialAccountId: accountId,
    scheduledAt,
    targetDurationMinutes,
  })

  return { data: result }
})
