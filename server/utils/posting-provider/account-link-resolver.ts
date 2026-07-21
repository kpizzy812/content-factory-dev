/**
 * Self-heal resolver для DeviceProfile <-> SocialAccount привязки.
 *
 * Логика 1:1:1 device-нейтральна. Канонический экспорт —
 * `resolveDeviceProfileForAccount` (поле результата `deviceProfileId`).
 * Indigo-совместимые алиасы снесены в R7.
 *
 * Зачем: историческое legacy состояние "наполовину отвязан" может оставить
 * SocialAccount.deviceProfileId = null при живой записи в DeviceProfileAccount
 * (или наоборот). Раньше unlink-account.post.ts чистил только denorm, не
 * нормализованную таблицу — после такого unlink check-login/deep-check
 * валились с "У аккаунта нет привязанного device profile" хотя в UI таба
 * profile был виден.
 *
 * Этот helper берёт accountId, читает оба источника (denorm + DeviceProfileAccount),
 * восстанавливает denorm если рассинхрон, и возвращает effective deviceProfileId.
 *
 * Возвращает null если у аккаунта **реально** нет привязки (ни denorm, ни
 * DeviceProfileAccount). В этом случае UI должен показать "Привяжите profile".
 */

import { prisma } from "../prisma"

export interface ResolvedDeviceProfile {
  /** ID профиля; null если у аккаунта реально нет привязки. */
  deviceProfileId: string | null
  /** true если был выполнен self-heal restore denorm. Полезно для логирования. */
  healed: boolean
}

/**
 * Резолвит effective deviceProfileId для SocialAccount с self-healing рассинхрона.
 *
 * Алгоритм:
 *   1. Читаем denorm SocialAccount.deviceProfileId + все DeviceProfileAccount
 *      записи где socialAccountId = id.
 *   2. Если denorm != null И запись в DeviceProfileAccount согласована — OK.
 *   3. Если denorm == null НО есть DeviceProfileAccount запись — heal:
 *      восстанавливаем denorm = profile.id из первой найденной записи.
 *      Также синхронизируем DeviceProfile.socialAccountId если нужно.
 *   4. Если denorm != null НО DeviceProfileAccount записи нет — ВОЗМОЖНО мусор,
 *      но НЕ чистим denorm здесь (это могла быть pending привязка). Возвращаем
 *      denorm как effective profileId — пусть caller разбирается на месте.
 *   5. Если ни того ни другого — реально не привязан, возвращаем null.
 */
export async function resolveDeviceProfileForAccount(
  accountId: number,
): Promise<ResolvedDeviceProfile> {
  const [account, links] = await Promise.all([
    prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: { id: true, deviceProfileId: true },
    }),
    prisma.deviceProfileAccount.findMany({
      where: { socialAccountId: accountId },
      select: { profileId: true },
      orderBy: { addedAt: "asc" },
    }),
  ])

  if (!account) {
    return { deviceProfileId: null, healed: false }
  }

  // Case: реально не привязан — обе source пустые.
  if (!account.deviceProfileId && links.length === 0) {
    return { deviceProfileId: null, healed: false }
  }

  // Case: denorm есть, links согласованы (или links пустые но denorm выставлен).
  if (account.deviceProfileId) {
    return {
      deviceProfileId: account.deviceProfileId,
      healed: false,
    }
  }

  // Case: denorm null, но есть IndigoProfileAccount запись — heal!
  // Восстанавливаем denorm в SocialAccount и в IndigoProfile (если у того тоже null).
  const firstLink = links[0]!
  const profileId = firstLink.profileId

  // Безопасный heal: только если профиль ещё существует в БД (cascade delete мог
  // удалить записи в IndigoProfileAccount, но в редкой race condition может
  // остаться запись на несуществующий profileId — fallback на null).
  const profile = await prisma.deviceProfile.findUnique({
    where: { id: profileId },
    select: { id: true, socialAccountId: true },
  })
  if (!profile) {
    // Орфан — DeviceProfileAccount запись на удалённый профиль. Чистим.
    await prisma.deviceProfileAccount.deleteMany({
      where: { socialAccountId: accountId, profileId },
    })
    return { deviceProfileId: null, healed: true }
  }

  // Восстанавливаем denorm атомарно.
  await prisma.$transaction(async (tx) => {
    await tx.socialAccount.update({
      where: { id: accountId },
      data: { deviceProfileId: profileId },
    })
    // Если у профиля тоже denorm пустой — восстановим (1:1:1 — единственный аккаунт primary).
    if (!profile.socialAccountId) {
      await tx.deviceProfile.update({
        where: { id: profileId },
        data: { socialAccountId: accountId },
      })
    }
  })

  console.warn(
    "[account-link-resolver] healed denorm rassincronizatsiya",
    JSON.stringify({ accountId, profileId, source: "DeviceProfileAccount" }),
  )

  return { deviceProfileId: profileId, healed: true }
}
