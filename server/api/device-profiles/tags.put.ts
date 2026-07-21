/**
 * PUT /api/device-profiles/tags { oldName, newName }
 *
 * Rename тега во всех IndigoProfile.tags. Реализуется через array_replace в SQL,
 * чтобы изменить значение в массиве, не пересоздавая записи.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const body = await readBody<{ oldName?: string; newName?: string }>(event)
  if (
    !body?.oldName
    || !body?.newName
    || !body.oldName.trim()
    || !body.newName.trim()
    || body.oldName.length > 64
    || body.newName.length > 64
  ) {
    throw createError({
      statusCode: 400,
      message: "oldName и newName обязательны (строка до 64 символов)",
    })
  }

  const oldName = body.oldName.trim()
  const newName = body.newName.trim()

  if (oldName === newName) return { data: { id: newName, name: newName } }

  // Обновить все профили где встречается oldName
  await prisma.$executeRaw`
    UPDATE "IndigoProfile"
    SET tags = array_replace(tags, ${oldName}, ${newName})
    WHERE ${oldName} = ANY(tags)
  `

  return { data: { id: newName, name: newName } }
})
