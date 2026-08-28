/**
 * GET /api/edit-profiles/:id
 *
 * Один монтажный профиль (§9 «Монтажный профиль»). Ответ — те же РАЗРЕШЁННЫЕ
 * значения, что и в списке (`presentEditProfile`), а не сырые колонки: см.
 * докстринг `server/utils/edit-plan/edit-profile-api.ts`.
 *
 * Зачем ручка нужна, если есть список. Список читается ПО `appId`, а у ролика
 * `appId` напрямую нет — он живёт на сценарии. Поэтому страница ролика ходила
 * за потолками расхода цепочкой `GET /api/scenarios/:id` → `appId` →
 * `GET /api/edit-profiles?appId=N`, то есть через ЧУЖОЙ модуль
 * (`script-generator`). У оператора без доступа к сценариям потолки не
 * показывались вовсе — при том что сам профиль он читать вправе.
 *
 * ПРО КОД ОТВЕТА НА ЧУЖОЙ ПРОФИЛЬ — 404, а не 403, и это не описка.
 *
 * У списка `appId` лежит В ЗАПРОСЕ, поэтому там авторизация выполняется до
 * любого чтения БД и посторонний получает 403 одинаково на существующее и
 * несуществующее приложение. Здесь в адресе только `EditProfile.id`:
 * выяснить, какому приложению принадлежит профиль, нельзя, не прочитав строку.
 * Значит единственный способ не сдать факт существования — отвечать на
 * «чужой» и «отсутствующий» ОДИНАКОВО. Отдай ручка 403 на чужой и 404 на
 * отсутствующий, перебор последовательных `id` выдал бы любому пользователю
 * модуля карту профилей всех арендаторов — ровно тот класс дефекта, который
 * ветка уже закрывала в `edit-profiles/index.get.ts` (Important 4 финального
 * ревью).
 *
 * Заметка на будущее: `PUT /api/edit-profiles/:id` этим свойством пока НЕ
 * обладает — он отвечает 403 на чужой профиль и 404 на несуществующий, то есть
 * оракул существования там открыт (для тех, у кого есть `canWrite`). Правка
 * PUT меняет уже зафиксированный тестами контракт и делается отдельно.
 */
import { presentEditProfile } from "~~/server/utils/edit-plan/edit-profile-api"

export default defineEventHandler(async (event) => {
  // Базовая проверка ДО чтения БД: она не зависит от того, чей это профиль, и
  // отсекает анонима (401) и пользователя без права/модуля (403) одинаково на
  // любом `id` — существующем и нет.
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "video-generator",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id профиля" })
  }

  const profile = await prisma.editProfile.findUnique({ where: { id } })
  if (!profile) throw createError({ statusCode: 404, message: "Профиль не найден" })

  // Права на КОНКРЕТНЫЙ профиль — симметрично PUT: профиль без владельца
  // (`appId: null`, общий шаблон) требует canAdmin, потому что
  // `requireScopedAccess` пропускает проверку назначений целиком, когда
  // `appId === undefined`; профиль приложения — назначения на это приложение.
  //
  // Отказ здесь превращается в 404 (см. докстринг файла): для того, кому
  // профиль не принадлежит, он неотличим от несуществующего.
  //
  // Проверка делается ПОВТОРНЫМ вызовом `requireScopedAccess`, а не собственным
  // разбором `user.appAssignments`: правило доступа к приложению живёт в
  // `server/utils/rbac.ts` (там же учитывается `accessLevel: "none"` и
  // admin-шорткат), и его копия здесь однажды разошлась бы с оригиналом.
  try {
    if (profile.appId === null) {
      await requireScopedAccess(event, {
        permissions: ["canRead", "canAdmin"],
        moduleSlug: "video-generator",
      })
    }
    else {
      await requireScopedAccess(event, {
        permissions: ["canRead"],
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
      throw createError({ statusCode: 404, message: "Профиль не найден" })
    }
    throw error
  }

  return { data: presentEditProfile(profile) }
})
