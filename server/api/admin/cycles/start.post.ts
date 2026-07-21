/**
 * POST /api/admin/cycles/start
 * Запуск нового производственного цикла.
 */
export default defineEventHandler(async (event) => {
  const user = await requirePermission(event, "canRunAgent")

  const body = await readBody(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  const appId = Number(body.appId)
  if (!appId || isNaN(appId)) {
    throw createError({ statusCode: 400, message: "appId обязателен" })
  }

  const app = await prisma.app.findUnique({ where: { id: appId } })
  if (!app) {
    throw createError({ statusCode: 404, message: "Приложение не найдено" })
  }

  const groupId = body.groupId ? Number(body.groupId) : undefined
  if (groupId) {
    const group = await prisma.accountGroup.findUnique({ where: { id: groupId } })
    if (!group) {
      throw createError({ statusCode: 404, message: "Группа аккаунтов не найдена" })
    }
  }

  const cycle = await prisma.productionCycle.create({
    data: {
      appId,
      groupId: groupId ?? null,
      startedById: user.id,
    },
  })

  // Fire-and-forget: запуск цикла без ожидания результата
  startCycle(cycle.id).catch(() => {})

  return { data: cycle }
})
