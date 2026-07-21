/**
 * POST /api/device-profiles/tags { name }
 *
 * @deprecated UX-эндпоинт. Тег-пул для Indigo формируется distinct unnest'ом из
 * IndigoProfile.tags (см. tags.get.ts) — отдельного storage нет, и реальный create
 * был бы no-op. Поэтому фронт (`IndigoProfileEditModal`) использует
 * `<TagPicker :allow-create="false">`, который не вызывает этот POST. Эндпоинт
 * оставлен только для обратной совместимости со старыми клиентами и возвращает
 * 201/409 по факту наличия тега в каком-либо профиле, без побочных эффектов.
 *
 * Удаление endpoint'а возможно после миграции всех клиентов (см. tags.get/put/delete —
 * они нужны для list / rename / delete from pool).
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const body = await readBody<{ name?: string }>(event)
  if (
    !body?.name
    || typeof body.name !== "string"
    || !body.name.trim()
    || body.name.length > 64
  ) {
    throw createError({
      statusCode: 400,
      message: "Название тега обязательно (строка до 64 символов)",
    })
  }

  const name = body.name.trim()

  // Проверяем — есть ли уже в каком-либо профиле
  const existsRows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "IndigoProfile" WHERE ${name} = ANY(tags)
    ) AS exists
  `
  if (existsRows[0]?.exists) {
    throw createError({ statusCode: 409, message: "Тег уже существует" })
  }

  // No-op: тег попадёт в пул когда оператор применит его к профилю (и сохранит).
  setResponseStatus(event, 201)
  return { data: { id: name, name } }
})
