/**
 * DELETE /api/scenes/:id — soft delete (archived=true).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const existing = await prisma.scene.findUnique({ where: { id }, select: { appId: true } })
  if (!existing) throw createError({ statusCode: 404, message: "Сцена не найдена" })

  await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "script-generator",
    appId: existing.appId,
  })

  await prisma.scene.update({ where: { id }, data: { archived: true } })
  return { data: { id, archived: true } }
})
