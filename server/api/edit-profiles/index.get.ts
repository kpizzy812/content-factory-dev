/**
 * GET /api/edit-profiles?appId=N
 *
 * Список монтажных профилей приложения (§9 «Монтажный профиль»). Каждый
 * элемент — РАЗРЕШЁННЫЕ значения (`resolveEditProfile`), см. докстринг
 * `server/utils/edit-plan/edit-profile-api.ts`.
 */
import { presentEditProfile } from "~~/server/utils/edit-plan/edit-profile-api"

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appId = Number(query.appId)
  if (!Number.isInteger(appId) || appId <= 0) {
    throw createError({ statusCode: 400, message: "Query-параметр appId обязателен и должен быть положительным целым числом" })
  }

  // Авторизация ПО `appId` ИЗ ЗАПРОСА — до любого ветвления по существованию
  // приложения (Important 4 финального ревью). Иначе разница 404 и 401/403
  // превращается в неавторизованный оракул: `App.id` — последовательные целые,
  // и перебор без единого права давал бы карту существующих приложений. Тот же
  // порядок и та же аргументация, что в докстринге
  // `apps/[id]/background-clips/[clipId].delete.ts`: `appId` целиком приходит
  // из запроса и чтения БД не требует, откладывать авторизацию незачем.
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "video-generator",
    appId,
  })

  const app = await prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
  if (!app) throw createError({ statusCode: 404, message: "Приложение не найдено" })

  const profiles = await prisma.editProfile.findMany({
    where: { appId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  })

  return { data: profiles.map(presentEditProfile) }
})
