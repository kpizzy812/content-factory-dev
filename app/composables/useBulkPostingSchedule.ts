/**
 * Client-side обёртка над generateBulkSchedule из server/utils/posting/bulk-scheduling.
 *
 * Алгоритм одинаков на сервере и клиенте — UI вычисляет расписание в реальном
 * времени для preflight таблицы, сервер потом валидирует через validateMinInterval
 * + validateScheduledInWindow.
 *
 * Зеркало server/utils/posting/bulk-scheduling.ts (без import чтобы избежать
 * пересборки server bundle в client; константы синхронизируются вручную).
 */

import { createSeededRng, type SeededRng } from "~~/shared/utils/seedable-rng"

export const SLOT_MS = 5 * 60 * 1000
export const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000
export const BULK_PAIRS_LIMIT = 50

export interface BulkPair {
  socialAccountId: number
  videoId: number
}

export interface ScheduledPair extends BulkPair {
  scheduledAt: string
}

export interface BulkScheduleInput {
  pairs: BulkPair[]
  windowStartMs: number
  windowEndMs: number
  minIntervalMs?: number
  seed: string
}

export interface BulkScheduleResult {
  scheduled: ScheduledPair[]
  unscheduled: Array<BulkPair & { reason: string }>
}

function roundToSlot(ms: number): number {
  return Math.floor(ms / SLOT_MS) * SLOT_MS
}

function randomSlotMs(rng: SeededRng, startMs: number, endMs: number): number {
  if (startMs >= endMs) return roundToSlot(startMs)
  const slotsCount = Math.floor((endMs - startMs) / SLOT_MS) + 1
  const idx = rng.int(0, slotsCount - 1)
  return roundToSlot(startMs) + idx * SLOT_MS
}

export function generateBulkSchedule(
  input: BulkScheduleInput,
): BulkScheduleResult {
  const minInterval = input.minIntervalMs ?? MIN_INTERVAL_MS
  const rng = createSeededRng(input.seed)

  if (input.windowStartMs >= input.windowEndMs) {
    return {
      scheduled: [],
      unscheduled: input.pairs.map((p) => ({ ...p, reason: "windowStart >= windowEnd" })),
    }
  }

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
    const windowMs = input.windowEndMs - input.windowStartMs
    const maxFitsInWindow = Math.floor(windowMs / minInterval) + 1
    const fits = Math.min(n, maxFitsInWindow)

    if (fits === 0) {
      for (const p of accountPairs) {
        unscheduled.push({ ...p, reason: "Окно слишком маленькое" })
      }
      continue
    }

    const segmentMs = Math.floor(windowMs / fits)
    const accountSchedule: number[] = []
    for (let i = 0; i < fits; i++) {
      const segmentStart = input.windowStartMs + i * segmentMs
      const segmentEnd = input.windowStartMs + (i + 1) * segmentMs
      let slot = randomSlotMs(rng, segmentStart, segmentEnd)

      if (accountSchedule.length > 0) {
        const prev = accountSchedule[accountSchedule.length - 1]!
        if (slot - prev < minInterval) {
          slot = roundToSlot(prev + minInterval)
        }
      }

      if (slot > input.windowEndMs) {
        accountSchedule.length = i
        break
      }
      accountSchedule.push(slot)
    }

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

  scheduled.sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  )
  return { scheduled, unscheduled }
}
