/**
 * PUT /api/edit-profiles/:id
 *
 * Частично обновляет монтажный профиль (§9 «Монтажный профиль»). `appId`
 * профиля неизменяем через этот эндпоинт: попытка передать другое значение —
 * 400, независимо от того, чужое это приложение или своё же. Профиль
 * принадлежит бренду/приложению по построению (спека §5.2); перепривязка —
 * не описанная в брифе операция, и тихо разрешать её здесь не нужно.
 */
import { parseEditProfileWrite, presentEditProfile, updateEditProfileExclusive } from "~~/server/utils/edit-plan/edit-profile-api"

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id профиля" })
  }

  const existing = await prisma.editProfile.findUnique({ where: { id } })
  if (!existing) throw createError({ statusCode: 404, message: "Профиль не найден" })

  // Профили без владельца (appId: null, шаблоны — вне рамок этой задачи, но
  // схема их допускает) требуют canAdmin: requireScopedAccess пропускает
  // проверку appAssignment целиком, когда appId === undefined, и без этого
  // условия любой пользователь с canWrite+moduleSlug смог бы редактировать
  // общий шаблон в обход поассайнментной модели доступа.
  if (existing.appId === null) {
    await requireScopedAccess(event, {
      permissions: ["canWrite", "canAdmin"],
      moduleSlug: "video-generator",
    })
  }
  else {
    await requireScopedAccess(event, {
      permissions: ["canWrite"],
      moduleSlug: "video-generator",
      appId: existing.appId,
    })
  }

  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(body, "appId")) {
    const requestedAppId = body.appId === null ? null : Number(body.appId)
    if (requestedAppId !== existing.appId) {
      throw createError({ statusCode: 400, message: "Нельзя изменить appId профиля" })
    }
  }

  const fields = parseEditProfileWrite(body, { requireName: false })

  const updated = await updateEditProfileExclusive(id, existing.appId, fields)

  return { data: presentEditProfile(updated) }
})
