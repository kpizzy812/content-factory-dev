/**
 * Anti-detect расписание для bulk YouTube postинга.
 *
 * Алгоритм:
 *   - Все scheduledAt round'ятся до 5-минутных слотов (SLOT_MS) — точная
 *     секунда выдаёт automation.
 *   - Per account: между двумя последовательными job'ами одного аккаунта
 *     минимум MIN_INTERVAL_MS (4 часа) — anti-detect (один аккаунт не
 *     постит часто).
 *   - Между разными аккаунтами интервал любой.
 *   - Seedable XorShift (см. server/utils/warmup/rng.ts) — детерминированно
 *     для unit тестов и оператор может пересчитать "тот же план" из тех же
 *     входов.
 *
 * Использование:
 *   const schedule = generateBulkSchedule({
 *     pairs: [{ socialAccountId, videoId }],
 *     windowStartMs, windowEndMs,
 *     minIntervalMs: 4 * 60 * 60 * 1000,
 *     seed: `bulk-${userId}-${Date.now()}`,
 *   })
 *   → Map<pairKey, scheduledAtIso>
 */

import { createSeededRng, type SeededRng } from "../../../shared/utils/seedable-rng"

/** 5-минутный слот — точные секунды дают automation-сигнатуру. */
export const SLOT_MS = 5 * 60 * 1000
/** Минимальный интервал между job'ами одного аккаунта (anti-detect). */
export const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000
/** Лимит на одну bulk-операцию (защита от случайных огромных запросов). */
export const BULK_PAIRS_LIMIT = 50

export interface BulkPair {
  socialAccountId: number
  videoId: number
}

export interface BulkScheduleInput {
  pairs: BulkPair[]
  windowStartMs: number
  windowEndMs: number
  minIntervalMs?: number
  seed: string
}

export interface ScheduledPair extends BulkPair {
  /** ISO datetime когда worker должен взять этот job. */
  scheduledAt: string
}

export interface BulkScheduleResult {
  scheduled: ScheduledPair[]
  /** Пары которые не удалось распределить (window слишком маленькое для всех job'ов account'а). */
  unscheduled: Array<BulkPair & { reason: string }>
}

/**
 * Округляет timestamp вниз до ближайшего 5-минутного слота.
 */
export function roundToSlot(ms: number): number {
  return Math.floor(ms / SLOT_MS) * SLOT_MS
}

/**
 * Возвращает рандомный slot в [start, end] с шагом SLOT_MS.
 * Если start > end — возвращает start (clamped).
 */
function randomSlotMs(rng: SeededRng, startMs: number, endMs: number): number {
  if (startMs >= endMs) return roundToSlot(startMs)
  const slotsCount = Math.floor((endMs - startMs) / SLOT_MS) + 1
  const idx = rng.int(0, slotsCount - 1)
  return roundToSlot(startMs) + idx * SLOT_MS
}

/**
 * Генерирует расписание для bulk-постинга.
 *
 * Гарантии:
 *   - Все scheduledAt ∈ [windowStartMs, windowEndMs]
 *   - Для каждого socialAccountId: все его scheduledAt отстоят друг от друга
 *     на ≥ minIntervalMs
 *   - Если для какого-то account window слишком маленькое (< (n-1)*minInterval) —
 *     "лишние" пары попадают в unscheduled с reason'ом
 *   - Детерминированно для того же seed/input
 */
export function generateBulkSchedule(
  input: BulkScheduleInput,
): BulkScheduleResult {
  const minInterval = input.minIntervalMs ?? MIN_INTERVAL_MS
  const rng = createSeededRng(input.seed)

  if (input.windowStartMs >= input.windowEndMs) {
    return {
      scheduled: [],
      unscheduled: input.pairs.map((p) => ({
        ...p,
        reason: "windowStart >= windowEnd",
      })),
    }
  }

  // Группируем пары по socialAccountId — каждая группа получает разнесённое
  // расписание с MIN_INTERVAL между job'ами.
  const byAccount = new Map<number, BulkPair[]>()
  for (const pair of input.pairs) {
    const arr = byAccount.get(pair.socialAccountId) ?? []
    arr.push(pair)
    byAccount.set(pair.socialAccountId, arr)
  }

  const scheduled: ScheduledPair[] = []
  const unscheduled: Array<BulkPair & { reason: string }> = []

  for (const [, accountPairs] of byAccount) {
    const n = accountPairs.length
    // Сколько MIN_INTERVAL слотов влезает в окно?
    const windowMs = input.windowEndMs - input.windowStartMs
    const maxFitsInWindow = Math.floor(windowMs / minInterval) + 1
    const fits = Math.min(n, maxFitsInWindow)

    if (fits === 0) {
      // Окно меньше одного слота — все unscheduled
      for (const p of accountPairs) {
        unscheduled.push({ ...p, reason: "Окно слишком маленькое" })
      }
      continue
    }

    // Базовая разбивка окна на fits сегментов.
    const segmentMs = Math.floor(windowMs / fits)
    const accountSchedule: number[] = []
    for (let i = 0; i < fits; i++) {
      const segmentStart = input.windowStartMs + i * segmentMs
      const segmentEnd = input.windowStartMs + (i + 1) * segmentMs
      let slot = randomSlotMs(rng, segmentStart, segmentEnd)

      // Защита MIN_INTERVAL: если предыдущий слот ближе чем minInterval —
      // сдвигаем текущий вправо на ровно minInterval.
      if (accountSchedule.length > 0) {
        const prev = accountSchedule[accountSchedule.length - 1]!
        if (slot - prev < minInterval) {
          slot = roundToSlot(prev + minInterval)
        }
      }

      // Если слот вышел за windowEnd — этот и все последующие unscheduled.
      if (slot > input.windowEndMs) {
        accountSchedule.length = i
        break
      }
      accountSchedule.push(slot)
    }

    // Распределяем пары по слотам (по индексу).
    for (let i = 0; i < accountPairs.length; i++) {
      const pair = accountPairs[i]!
      if (i < accountSchedule.length) {
        scheduled.push({
          ...pair,
          scheduledAt: new Date(accountSchedule[i]!).toISOString(),
        })
      } else {
        unscheduled.push({
          ...pair,
          reason: "MIN_INTERVAL вытеснил пару за пределы окна",
        })
      }
    }
  }

  // Сортируем по scheduledAt для красивого отображения
  scheduled.sort((a, b) =>
    new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  )

  return { scheduled, unscheduled }
}

/**
 * Проверяет что заранее построенное расписание (например клиентом) соблюдает
 * MIN_INTERVAL per account. Возвращает первое нарушение или null.
 *
 * Используется на сервере перед массовым INSERT — защита от случаев когда
 * клиент собрал кривое расписание (баг или вредонос).
 */
export function validateMinInterval(
  scheduled: ScheduledPair[],
  minIntervalMs: number = MIN_INTERVAL_MS,
): { accountId: number; conflict: [string, string] } | null {
  const byAccount = new Map<number, number[]>()
  for (const p of scheduled) {
    const t = new Date(p.scheduledAt).getTime()
    if (Number.isNaN(t)) {
      return { accountId: p.socialAccountId, conflict: [p.scheduledAt, "Invalid date"] }
    }
    const arr = byAccount.get(p.socialAccountId) ?? []
    arr.push(t)
    byAccount.set(p.socialAccountId, arr)
  }

  for (const [accountId, times] of byAccount) {
    times.sort((a, b) => a - b)
    for (let i = 1; i < times.length; i++) {
      const diff = times[i]! - times[i - 1]!
      if (diff < minIntervalMs) {
        return {
          accountId,
          conflict: [
            new Date(times[i - 1]!).toISOString(),
            new Date(times[i]!).toISOString(),
          ],
        }
      }
    }
  }

  return null
}

/**
 * Проверяет что все scheduledAt попадают в окно [windowStart, windowEnd].
 */
export function validateScheduledInWindow(
  scheduled: ScheduledPair[],
  windowStartMs: number,
  windowEndMs: number,
): ScheduledPair | null {
  for (const p of scheduled) {
    const t = new Date(p.scheduledAt).getTime()
    if (Number.isNaN(t) || t < windowStartMs || t > windowEndMs) {
      return p
    }
  }
  return null
}
