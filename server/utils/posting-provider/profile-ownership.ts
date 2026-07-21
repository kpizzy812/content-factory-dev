/**
 * Tenant-isolation helper для DeviceProfile.
 *
 * Все API endpoints, оперирующие конкретным профилем по id (GET/PUT/DELETE/accounts),
 * должны после `requireScopedAccess(...)` проверить владельца профиля через эту утилиту —
 * иначе любой авторизованный юзер с canRead/canWrite в модуле social-upload мог бы
 * читать/менять/удалять профили других операторов.
 *
 * Device-нейтральная утилита: не зависит от провайдера антидетект-браузера
 * (Indigo/DuoPlus/Multilogin) — только Prisma + RBAC. Пережила R5b-удаление
 * браузерного util-слоя (бывший indigo/auth.ts) как часть device-нейтрального ядра.
 *
 * Семантика admin bypass соответствует CLAUDE.md / server/utils/rbac.ts:
 *   - canAdmin=true → bypass (админу видны все профили в системе).
 *   - createdById === user.id → access OK.
 *   - createdById === null (legacy/seeded профили) → доступ только админу.
 */
import type { DeviceProfile } from "../../../app/generated/prisma/client"
import type { AuthUser } from "../rbac"

/**
 * Загружает DeviceProfile по id и проверяет что текущий user — владелец или админ.
 * Возвращает строго типизированный профиль (без `include`). Если нужны relations —
 * сделайте второй запрос с `findUnique({ include: ... })` уже после проверки.
 *
 * @throws 400 если id невалидный
 * @throws 404 если профиль не найден
 * @throws 403 если user не владелец и не админ
 */
export async function requireProfileOwnership(
  id: string | undefined,
  user: AuthUser,
): Promise<DeviceProfile> {
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор" })
  }

  const profile = await prisma.deviceProfile.findUnique({ where: { id } })
  if (!profile) {
    throw createError({ statusCode: 404, message: "Профиль устройства не найден" })
  }

  if (user.canAdmin) return profile
  if (profile.createdById && profile.createdById === user.id) return profile

  throw createError({
    statusCode: 403,
    message: "Нет доступа к этому профилю",
  })
}
