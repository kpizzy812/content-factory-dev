/**
 * DELETE /api/apps/:id/background-clips/:clipId
 *
 * Удаление — МЯГКОЕ (`isActive: false`), а не строки: на фон могут ссылаться
 * кадры уже собранных роликов (`VideoShot.backgroundClipId`, `onDelete: SetNull`
 * снимет ссылку только при удалении строки, а нам нужно её сохранить).
 *
 * Порядок проверок нарочно такой:
 *  1. Авторизация ПО `appId` ИЗ URL — до чтения клипа и до любого ветвления
 *     по его существованию. Если бы клип читался первым (как в большинстве
 *     соседних эндпоинтов, где appId неизвестен заранее и его ещё только
 *     предстоит узнать из сущности), разница 404 (клипа с таким id под этим
 *     appId нет) и 401/403 (клип есть, но доступа нет) превратилась бы в
 *     неавторизованный оракул принадлежности: пользователь БЕЗ единого
 *     доступа к чужому appId мог бы перебором clipId выяснять, какие фоны
 *     реально существуют в чужом приложении, не имея прав вообще ни на что
 *     там. Здесь `appId` целиком приходит из URL и не требует чтения БД,
 *     поэтому откладывать авторизацию до фетча клипа незачем.
 *  2. Сверка владения — по РЕАЛЬНОМУ `clip.appId`, а не повторным доверием
 *     параметру URL: тот же приём, что в прецеденте
 *     `characters/[id]/source-clips/[clipId].delete.ts` (`appId: clip.character.appId`).
 *     `appId` из URL уже прошёл авторизацию на шаге 1, но окончательное
 *     решение "этот клип наш" принимается по полю самой строки.
 *
 * В ответ уходит обновлённый список — той же формы, что у GET, вместе с
 * `previewUrl` у каждого клипа: иначе после удаления карточки соседей потеряли
 * бы превью до следующей перезагрузки страницы.
 */
import { withBackgroundPreviewUrls } from "~~/server/utils/edit-plan/background-preview"

export default defineEventHandler(async (event) => {
  const appId = Number(getRouterParam(event, "id"))
  const clipId = getRouterParam(event, "clipId")
  if (!Number.isInteger(appId) || appId <= 0 || !clipId) {
    throw createError({ statusCode: 400, message: "id и clipId обязательны" })
  }

  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "video-generator",
    appId,
  })

  const clip = await prisma.backgroundClip.findUnique({ where: { id: clipId } })
  if (!clip || clip.appId !== appId) {
    throw createError({ statusCode: 404, message: "Фон не найден" })
  }

  await prisma.backgroundClip.update({ where: { id: clip.id }, data: { isActive: false } })

  const clips = await prisma.backgroundClip.findMany({
    where: { appId, isActive: true },
    orderBy: [{ usageCount: "asc" }, { createdAt: "desc" }],
  })

  return { data: await withBackgroundPreviewUrls(clips) }
})
