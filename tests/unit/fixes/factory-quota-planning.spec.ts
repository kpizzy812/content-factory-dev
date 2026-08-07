/**
 * Регрессии P0-11 и P0-12 (docs/audit/spec-conformance-2026-08-07.md).
 *
 * P0-11. `planFactoryAssignments` раскладывал партию по одному числу на всех
 *   (`dailyLimitPerAccount`, по умолчанию 50 из тела запроса), хотя фактическая
 *   квота площадки уже лежит в `SocialAccount.publishingQuotaTotal/Usage`.
 *   PROJECT_CONTEXT §3 требует обратного: лимит считается по каждому аккаунту,
 *   и для Instagram его надо запрашивать, а не хардкодить. На старом поведении
 *   аккаунт с реальной квотой 10 получал 50 публикаций — сорок из них площадка
 *   отвергла бы.
 *
 * P0-12. Исчерпанная квота уводила публикацию в терминальный провал. Лимит
 *   Instagram катится 24 часа, а автоповтор загрузок делает три попытки за 80
 *   минут — публикация сгорала гарантированно. Прогноз восстановления уже
 *   считается в `computePublishingCapacity`, но никем не использовался.
 *
 * Сьюта чистая: prisma подменяется через vi.mock, потому что
 * `publishing-capacity.ts` тянет клиент БД ради своей асинхронной части.
 * Проверяемые здесь функции — чистые.
 *
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  planFactoryAssignments,
  type FactoryAccountCandidate,
} from '~~/server/utils/content-factory-batch'

// БД в этой сьюте не нужна: трогаем только чистые функции модуля ёмкости.
vi.mock('~~/server/utils/prisma', () => ({ prisma: {} }))

const {
  isPublishingQuotaExhausted,
  nextRecoveryAt,
  planQuotaDeferral,
} = await import('~~/server/utils/accounts/publishing-capacity')

const NOW = new Date('2026-08-07T12:00:00.000Z')

/** Свежий замер квоты: планировщик обязан ему верить. */
function withQuota(
  id: number,
  quotaTotal: number,
  quotaUsage = 0,
  extra: Partial<FactoryAccountCandidate> = {},
): FactoryAccountCandidate {
  return {
    id,
    platform: 'instagram',
    quotaTotal,
    quotaUsage,
    quotaCheckedAt: new Date(NOW.getTime() - 10 * 60_000),
    ...extra,
  }
}

describe('P0-11: партия раскладывается по фактической квоте аккаунтов', () => {
  it('не даёт аккаунту больше слотов, чем осталось по его собственной квоте', () => {
    // Фолбэк 50 на всех; фактические квоты — 10 и 40, суммарно ровно 50.
    const plan = planFactoryAssignments({
      count: 50,
      platforms: ['instagram'],
      dailyLimitPerAccount: 50,
      now: NOW,
      accounts: [withQuota(1, 10), withQuota(2, 40)],
    })

    expect(plan.ok).toBe(true)
    const perAccount = new Map<number, number>()
    for (const item of plan.items) {
      const id = item.assignments[0]!.socialAccountId
      perAccount.set(id, (perAccount.get(id) ?? 0) + 1)
    }
    // Старое поведение отдавало по 25 на аккаунт: 15 публикаций сверх квоты №1.
    expect(perAccount.get(1)).toBe(10)
    expect(perAccount.get(2)).toBe(40)
    expect(plan.capacity[0]).toMatchObject({ availableSlots: 50, accountsWithoutQuota: 0 })
  })

  it('учитывает уже израсходованную часть квоты площадки', () => {
    const plan = planFactoryAssignments({
      count: 6,
      platforms: ['instagram'],
      dailyLimitPerAccount: 50,
      now: NOW,
      accounts: [withQuota(1, 10, 8), withQuota(2, 10, 6)],
    })

    expect(plan.ok).toBe(true)
    expect(plan.capacity[0]?.availableSlots).toBe(6)
    const perAccount = new Map<number, number>()
    for (const item of plan.items) {
      const id = item.assignments[0]!.socialAccountId
      perAccount.set(id, (perAccount.get(id) ?? 0) + 1)
    }
    expect(perAccount.get(1)).toBe(2)
    expect(perAccount.get(2)).toBe(4)
  })

  it('отвергает партию, которая не влезает в реальные квоты, целиком', () => {
    const plan = planFactoryAssignments({
      count: 300,
      platforms: ['instagram'],
      dailyLimitPerAccount: 50,
      now: NOW,
      // Шесть аккаунтов, но фактическая квота у каждого 20, а не 50.
      accounts: Array.from({ length: 6 }, (_, index) => withQuota(index + 1, 20)),
    })

    expect(plan.ok).toBe(false)
    expect(plan.items).toEqual([])
    expect(plan.shortages[0]).toMatchObject({ availableSlots: 120, requestedSlots: 300 })
  })

  it('берёт фолбэк при неизвестной и при протухшей квоте и помечает это', () => {
    const plan = planFactoryAssignments({
      count: 4,
      platforms: ['instagram'],
      dailyLimitPerAccount: 2,
      now: NOW,
      accounts: [
        // Замера не было вовсе.
        { id: 1, platform: 'instagram' },
        // Замер старше суток: описывает уже другой день.
        {
          id: 2,
          platform: 'instagram',
          quotaTotal: 50,
          quotaUsage: 0,
          quotaCheckedAt: new Date(NOW.getTime() - 25 * 3_600_000),
        },
      ],
    })

    expect(plan.ok).toBe(true)
    expect(plan.capacity[0]).toMatchObject({ availableSlots: 4, accountsWithoutQuota: 2 })
    expect(plan.fallbacks.map(item => [item.socialAccountId, item.fallbackReason])).toEqual([
      [1, 'no_snapshot'],
      [2, 'stale_snapshot'],
    ])
    // Протухший замер на 50 не должен был дать аккаунту №2 больше фолбэка.
    const perAccount = new Map<number, number>()
    for (const item of plan.items) {
      const id = item.assignments[0]!.socialAccountId
      perAccount.set(id, (perAccount.get(id) ?? 0) + 1)
    }
    expect(perAccount.get(2)).toBe(2)
  })

  it('не подменяет фолбэком известную нулевую ёмкость', () => {
    const plan = planFactoryAssignments({
      count: 1,
      platforms: ['instagram'],
      dailyLimitPerAccount: 50,
      now: NOW,
      accounts: [withQuota(1, 25, 25)],
    })

    // Ничего не сгорает: партия не создаётся вовсе, аккаунт виден с нулём.
    expect(plan.ok).toBe(false)
    expect(plan.items).toEqual([])
    expect(plan.capacity[0]).toMatchObject({ accounts: 0, availableSlots: 0 })
    expect(plan.limits).toEqual([
      { socialAccountId: 1, platform: 'instagram', limit: 25, used: 25, free: 0, source: 'platform' },
    ])
    expect(plan.fallbacks).toEqual([])
  })

  it('не выпускает партию, когда для одной из площадок аккаунтов нет', () => {
    const plan = planFactoryAssignments({
      count: 2,
      platforms: ['instagram', 'tiktok'],
      dailyLimitPerAccount: 50,
      now: NOW,
      accounts: [withQuota(1, 50)],
    })

    expect(plan.ok).toBe(false)
    expect(plan.items).toEqual([])
    expect(plan.shortages.map(item => item.platform)).toEqual(['tiktok'])
    expect(plan.shortages[0]).toMatchObject({ accounts: 0, availableSlots: 0, requiredAccounts: 1 })
  })
})

describe('P0-12: исчерпанная квота переносит публикацию, а не сжигает её', () => {
  it('отличает исчерпанную квоту от обычной ошибки публикации', () => {
    expect(isPublishingQuotaExhausted('Instagram publishing quota exhausted (50/50)')).toBe(true)
    expect(isPublishingQuotaExhausted('caption exceeds 2200 characters')).toBe(false)
    expect(isPublishingQuotaExhausted(null)).toBe(false)
  })

  it('переносит на час, к которому по прогнозу освободится слот', () => {
    const decision = planQuotaDeferral({
      errorMessage: 'Instagram publishing quota exhausted (50/50)',
      recovery: [
        { hour: '2026-08-07T12:00:00.000Z', recovered: 0 },
        { hour: '2026-08-07T13:00:00.000Z', recovered: 0 },
        { hour: '2026-08-07T14:00:00.000Z', recovered: 3 },
      ],
      now: NOW,
    })

    expect(decision).toEqual({ defer: true, retryAt: new Date('2026-08-07T14:00:00.000Z') })
  })

  it('переносит на час вперёд, когда прогноза восстановления нет', () => {
    const decision = planQuotaDeferral({
      errorMessage: 'Instagram publishing quota exhausted (50/50)',
      recovery: [{ hour: '2026-08-07T12:00:00.000Z', recovered: 0 }],
      fullyRecoveredAt: null,
      now: NOW,
    })

    expect(decision).toEqual({ defer: true, retryAt: new Date('2026-08-07T13:00:00.000Z') })
  })

  it('не переносит то, что квотой не объясняется', () => {
    expect(planQuotaDeferral({
      errorMessage: 'Аккаунт неактивен',
      recovery: [{ hour: '2026-08-07T14:00:00.000Z', recovered: 5 }],
      now: NOW,
    })).toEqual({ defer: false })
  })

  it('ищет час, к которому наберётся нужное число слотов, а не первый освободившийся', () => {
    const recovery = [
      { hour: '2026-08-07T13:00:00.000Z', recovered: 1 },
      { hour: '2026-08-07T15:00:00.000Z', recovered: 2 },
      { hour: '2026-08-07T18:00:00.000Z', recovered: 4 },
    ]

    expect(nextRecoveryAt(recovery, 1)).toBe('2026-08-07T13:00:00.000Z')
    expect(nextRecoveryAt(recovery, 3)).toBe('2026-08-07T15:00:00.000Z')
    expect(nextRecoveryAt(recovery, 7)).toBe('2026-08-07T18:00:00.000Z')
    // Столько за сутки не наберётся — переносить не на что.
    expect(nextRecoveryAt(recovery, 8)).toBeNull()
  })
})
