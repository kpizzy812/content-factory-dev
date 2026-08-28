/**
 * DELETE /api/edit-profiles/:id
 *
 * Удаляет монтажный профиль (§9 «Монтажный профиль»). До этой ручки созданный
 * по ошибке профиль оставался в приложении навсегда.
 *
 * ПРО КОДЫ ОТВЕТА — симметрично `GET /api/edit-profiles/:id`, и по той же
 * причине. В адресе только `EditProfile.id`; чьё это приложение, без чтения
 * строки не узнать. Значит единственный способ не сдать факт существования —
 * отвечать на «чужой» и «отсутствующий» ОДИНАКОВО. Отдай ручка 403 на чужой и
 * 404 на отсутствующий, перебор последовательных `id` выдал бы карту профилей
 * всех арендаторов — тот же класс дефекта, что уже закрывали в
 * `edit-profiles/index.get.ts` и в GET по id. Разница с GET только в праве:
 * `canDelete` вместо `canRead` (соглашение остальных DELETE-ручек проекта,
 * например `scenarios/profiles/[id].delete.ts`).
 *
 * ПРО СВЯЗИ — вся аргументация в `server/utils/edit-plan/edit-profile-delete.ts`.
 * Коротко: профиль, на который ссылаются ролики, не удаляется (409), потому что
 * `onDelete: SetNull` подменил бы историю уже смонтированного ролика; дефолт
 * приложения переезжает на преемника той же транзакцией, иначе приложение
 * остаётся со списком профилей, из которых не действует ни один.
 */
import {
  deleteEditProfileExclusive,
  planEditProfileDeletion,
} from "~~/server/utils/edit-plan/edit-profile-delete"

/** Один текст на «нет такого» и «не твой» — их нельзя различать снаружи. */
const NOT_FOUND = "Профиль не найден"

export default defineEventHandler(async (event) => {
  // Базовая проверка ДО чтения БД: она не зависит от того, чей это профиль, и
  // отсекает анонима (401) и пользователя без права/модуля (403) одинаково на
  // любом `id` — существующем и нет.
  await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "video-generator",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id профиля" })
  }

  const profile = await prisma.editProfile.findUnique({
    where: { id },
    select: { id: true, appId: true, name: true, isDefault: true },
  })
  if (!profile) throw createError({ statusCode: 404, message: NOT_FOUND })

  // Права на КОНКРЕТНЫЙ профиль — тем же приёмом, что в GET и PUT: профиль без
  // владельца (`appId: null`, общий шаблон) требует canAdmin, потому что
  // `requireScopedAccess` пропускает проверку назначений целиком, когда
  // `appId === undefined`. Проверка делается ПОВТОРНЫМ вызовом
  // `requireScopedAccess`, а не собственным разбором назначений: правило живёт
  // в `server/utils/rbac.ts`, и его копия здесь однажды разошлась бы с оригиналом.
  try {
    if (profile.appId === null) {
      await requireScopedAccess(event, {
        permissions: ["canDelete", "canAdmin"],
        moduleSlug: "video-generator",
      })
    }
    else {
      await requireScopedAccess(event, {
        permissions: ["canDelete"],
        moduleSlug: "video-generator",
        appId: profile.appId,
      })
    }
  }
  catch (error) {
    // Подменяется ТОЛЬКО отказ доступа. Сбой чтения сессии или базы обязан
    // остаться собой: 404 на месте 500 отправил бы разбираться не туда.
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode === 401 || statusCode === 403) {
      throw createError({ statusCode: 404, message: NOT_FOUND })
    }
    throw error
  }

  const [videoCount, siblings] = await Promise.all([
    prisma.video.count({ where: { editProfileId: profile.id } }),
    // Соседи нужны только дефолтному профилю приложения — но запрос дешёвый
    // (индекс `@@index([appId, isDefault])`), а ветвление здесь развело бы
    // решение по двум местам: считает его `planEditProfileDeletion`.
    prisma.editProfile.findMany({
      where: { appId: profile.appId, id: { not: profile.id } },
      select: { id: true, name: true, createdAt: true },
    }),
  ])

  const plan = planEditProfileDeletion({ profile, videoCount, siblings })
  if (!plan.allowed) {
    throw createError({ statusCode: plan.statusCode, message: plan.message })
  }

  await deleteEditProfileExclusive(profile.id, plan.promoteDefaultId)

  return {
    data: {
      id: profile.id,
      promotedDefaultId: plan.promoteDefaultId,
      promotedDefaultName: plan.promoteDefaultName,
      note: plan.note,
    },
  }
})
