/**
 * DELETE /api/apps/:id/background-clips/:clipId
 *
 * Удаление — МЯГКОЕ (`isActive: false`), а не строки: на фон могут ссылаться
 * кадры уже собранных роликов (`VideoShot.backgroundClipId`, `onDelete: SetNull`
 * снимет ссылку только при удалении строки, а нам нужно её сохранить).
 *
 * Поиск клипа СРАЗУ фильтруется по appId из URL, а не только по id: без этого
 * фильтра запрос на `id`, принадлежащий чужому приложению, был бы найден и
 * погашен — это ровно класс дефекта из долга плана A (контроль доступа без
 * автотеста), закрытый здесь мутационным тестом в tests/api/edit-plan-endpoints.spec.ts.
 */
export default defineEventHandler(async (event) => {
  const appId = Number(getRouterParam(event, "id"))
  const clipId = getRouterParam(event, "clipId")
  if (!Number.isInteger(appId) || appId <= 0 || !clipId) {
    throw createError({ statusCode: 400, message: "id и clipId обязательны" })
  }

  const clip = await prisma.backgroundClip.findFirst({ where: { id: clipId, appId } })
  if (!clip) throw createError({ statusCode: 404, message: "Фон не найден" })

  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "video-generator",
    appId,
  })

  await prisma.backgroundClip.update({ where: { id: clip.id }, data: { isActive: false } })

  const clips = await prisma.backgroundClip.findMany({
    where: { appId, isActive: true },
    orderBy: [{ usageCount: "asc" }, { createdAt: "desc" }],
  })

  return { data: clips }
})
