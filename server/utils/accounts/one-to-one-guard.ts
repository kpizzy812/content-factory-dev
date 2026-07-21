/**
 * 1:1:1 ENFORCEMENT (PR4) — application-level guard.
 *
 * Идеология: один аккаунт ↔ один прокси ↔ один Indigo-профиль для
 * browser_automation. Это application-уровневая проверка ПЕРЕД ударом об
 * partial UNIQUE INDEX (миграция 20260603070743_one_to_one_browser_automation),
 * чтобы оператор получил дружелюбную 409 вместо сырой ошибки БД.
 *
 * ВАЖНО: ограничение касается ТОЛЬКО browser_automation. Для api-аккаунтов
 * шеринг прокси легитимен (см. ТЗ / план PR4) — guard не вызывается / не блокирует.
 */
import type { Prisma, PrismaClient } from "~~/app/generated/prisma/client"
import { prisma as defaultPrisma } from "~~/server/utils/prisma"

/**
 * Минимальный клиент, достаточный для guard. Подходит и обычный PrismaClient,
 * и транзакционный Prisma.TransactionClient — оба имеют socialAccount.findFirst.
 */
type GuardPrismaClient = Pick<PrismaClient, "socialAccount"> | Prisma.TransactionClient

export interface OneToOneTarget {
  /** Прокси, который пытаются закрепить за browser_automation-аккаунтом. */
  proxyId?: string | null
  /** Device-профиль, который пытаются закрепить за browser_automation-аккаунтом. */
  deviceProfileId?: string | null
}

/**
 * Проверяет, что НЕТ другого browser_automation-аккаунта (id != accountId),
 * который уже занимает заданный proxyId и/или deviceProfileId.
 *
 * @param accountId  id проверяемого аккаунта (исключается из поиска занятости).
 *                   Для ещё не созданного аккаунта передать 0 / отрицательное —
 *                   тогда исключения не будет (поиск по всем).
 * @param target     { proxyId?, deviceProfileId? } — что собираемся закрепить.
 *                   null/undefined-значения пропускаются (нечего проверять).
 * @param client     опциональный Prisma tx-клиент для вызова внутри транзакции.
 * @throws createError 409 proxy_shared_browser_automation / indigo_profile_shared
 */
export async function assertOneToOneForBrowserAutomation(
  accountId: number,
  target: OneToOneTarget,
  client?: GuardPrismaClient,
): Promise<void> {
  const db = (client ?? defaultPrisma) as GuardPrismaClient
  const proxyId = target.proxyId ?? null
  const deviceProfileId = target.deviceProfileId ?? null

  // accountId<=0 → новый аккаунт, не исключаем никого. Иначе исключаем сам аккаунт.
  const notSelf = accountId > 0 ? { id: { not: accountId } } : {}

  // (а) Прокси занят другим browser_automation-аккаунтом?
  if (proxyId) {
    const occupant = await db.socialAccount.findFirst({
      where: {
        ...notSelf,
        proxyId,
        postingMethod: "browser_automation",
      },
      select: { id: true, displayName: true, platform: true },
    })
    if (occupant) {
      throw createError({
        statusCode: 409,
        statusMessage: "proxy_shared_browser_automation",
        message:
          `Прокси уже закреплён за browser_automation-аккаунтом ` +
          `#${occupant.id} "${occupant.displayName}". Для browser_automation ` +
          `действует правило 1:1 (один прокси — один аккаунт).`,
        data: {
          code: "proxy_shared_browser_automation",
          proxyId,
          occupiedByAccountId: occupant.id,
          occupiedByAccountName: occupant.displayName,
          occupiedByPlatform: occupant.platform,
          suggestion:
            "Отвяжите прокси от занятого аккаунта или используйте другой прокси.",
        },
      })
    }
  }

  // (б) Device-профиль занят другим browser_automation-аккаунтом? (W4)
  if (deviceProfileId) {
    const occupant = await db.socialAccount.findFirst({
      where: {
        ...notSelf,
        deviceProfileId,
        postingMethod: "browser_automation",
      },
      select: { id: true, displayName: true, platform: true },
    })
    if (occupant) {
      throw createError({
        statusCode: 409,
        statusMessage: "indigo_profile_shared",
        message:
          `Indigo-профиль уже закреплён за browser_automation-аккаунтом ` +
          `#${occupant.id} "${occupant.displayName}". Для browser_automation ` +
          `действует правило 1:1 (один профиль — один аккаунт).`,
        data: {
          code: "indigo_profile_shared",
          deviceProfileId,
          occupiedByAccountId: occupant.id,
          occupiedByAccountName: occupant.displayName,
          occupiedByPlatform: occupant.platform,
          suggestion:
            "Отвяжите профиль от занятого аккаунта или используйте другой профиль.",
        },
      })
    }
  }
}
