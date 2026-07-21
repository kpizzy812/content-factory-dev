/**
 * DELETE /api/characters/:id — soft delete (archived=true). Hard delete блокируется
 * чтобы не сломать ссылки в Scene.blocks (character блоки).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const existing = await prisma.character.findUnique({ where: { id }, select: { appId: true } })
  if (!existing) throw createError({ statusCode: 404, message: "Персонаж не найден" })

  await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "script-generator",
    appId: existing.appId,
  })

  await prisma.character.update({
    where: { id },
    data: { archived: true },
  })

  return { data: { id, archived: true } }
})
