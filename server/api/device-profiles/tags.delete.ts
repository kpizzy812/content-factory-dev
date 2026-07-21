/**
 * DELETE /api/device-profiles/tags { name }
 *
 * Удаляет тег из всех IndigoProfile.tags. Реализуется через array_remove.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const body = await readBody<{ name?: string }>(event)
  if (!body?.name || typeof body.name !== "string" || !body.name.trim()) {
    throw createError({ statusCode: 400, message: "Название тега обязательно" })
  }

  const name = body.name.trim()

  await prisma.$executeRaw`
    UPDATE "IndigoProfile"
    SET tags = array_remove(tags, ${name})
    WHERE ${name} = ANY(tags)
  `

  return { data: { removed: name } }
})
