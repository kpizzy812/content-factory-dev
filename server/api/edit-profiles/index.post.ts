/**
 * POST /api/edit-profiles
 *
 * Создаёт монтажный профиль приложения (§9 «Монтажный профиль»). `appId`
 * обязателен в теле: создание профиля-шаблона без привязки к приложению
 * (`appId: null`, схема это допускает под будущую библиотеку шаблонов) — вне
 * рамок этой задачи, см. «Что этот план сознательно не делает» в брифе.
 */
import { createEditProfileExclusive, parseEditProfileWrite, presentEditProfile } from "~~/server/utils/edit-plan/edit-profile-api"

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>
  const appId = Number(body.appId)
  if (!Number.isInteger(appId) || appId <= 0) {
    throw createError({ statusCode: 400, message: "Поле \"appId\" обязательно и должно быть положительным целым числом" })
  }

  // Авторизация ПО `appId` ИЗ ТЕЛА — до любого ветвления по существованию
  // приложения (Important 4 финального ревью): иначе разница 404 и 401/403
  // работает неавторизованным оракулом существования `App.id`. Порядок и
  // аргументация — как в докстринге
  // `apps/[id]/background-clips/[clipId].delete.ts`.
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "video-generator",
    appId,
  })

  const app = await prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
  if (!app) throw createError({ statusCode: 404, message: "Приложение не найдено" })

  const fields = parseEditProfileWrite(body, { requireName: true })

  const created = await createEditProfileExclusive(appId, { ...fields, name: fields.name! })

  return { data: presentEditProfile(created) }
})
