/**
 * Лимит публикаций площадки.
 *
 * Величину отдаёт только Instagram и только в момент отправки: адаптер
 * спрашивает `content_publishing_limit` перед созданием контейнера, чтобы не
 * бить в исчерпанную квоту. До сих пор ответ жил ровно один вызов и нигде не
 * сохранялся — из-за этого в интерфейсе не было ни колонки «34 / 50», ни
 * свободной ёмкости на сутки.
 *
 * Сохраняем снимок, а не «текущее состояние»: рядом со значением лежит время
 * замера, и интерфейс показывает его возраст. Отдельного опроса площадки ради
 * свежей цифры не делаем — это лишний внешний вызов на каждый показ списка.
 */

import { prisma } from '../prisma'

export interface PublishingLimitSnapshot {
  quotaUsage: number | null
  quotaTotal: number | null
}

/**
 * Записывает замер лимита. Ошибка записи не должна ронять публикацию: это
 * справочная величина, а не часть контракта отправки.
 */
export async function recordPublishingLimit(
  accountId: number,
  snapshot: PublishingLimitSnapshot,
  now: Date = new Date(),
): Promise<void> {
  if (snapshot.quotaUsage === null && snapshot.quotaTotal === null) return

  try {
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        publishingQuotaUsage: snapshot.quotaUsage,
        publishingQuotaTotal: snapshot.quotaTotal,
        publishingQuotaAt: now,
      },
    })
  } catch (error) {
    console.warn('[publishing-limit] не удалось сохранить замер лимита', accountId, error)
  }
}

/** Замер старше суток описывает уже другой день — квота катится 24 часа. */
export function isLimitStale(checkedAt: Date | string | null, now: number = Date.now()): boolean {
  if (!checkedAt) return true
  const stamp = typeof checkedAt === 'string' ? new Date(checkedAt).getTime() : checkedAt.getTime()
  if (!Number.isFinite(stamp)) return true
  return now - stamp > 24 * 3_600_000
}
