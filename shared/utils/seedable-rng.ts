/**
 * Seedable XorShift32 RNG для детерминистической генерации.
 *
 * Используется:
 *   - server/utils/warmup/rng.ts — warmup плана (через re-export для backwards compat)
 *   - server/utils/posting/bulk-scheduling.ts — bulk YouTube расписание
 *   - app/composables/useBulkPostingSchedule.ts — client preview расписания
 *
 * Гарантия: createSeededRng(seed) → одинаковая последовательность вызовов
 * .float()/.int(...) → одинаковый результат на сервере и клиенте.
 *
 * Алгоритм XorShift32 — простой быстрый PRNG, достаточно равномерный для наших
 * нужд (выбор взвешенных action'ов, длительность из диапазона, рандомные слоты).
 *
 * Вход seed — строка вида 'accountId:YYYY-MM-DD' или 'bulk-userId-timestamp'.
 * Хешируется в uint32 простым sdbm (стабильно между Node и браузером).
 */

export interface SeededRng {
  /** Случайное число 0..1 (как Math.random). */
  float(): number
  /** Случайное целое в [min, max] включительно. */
  int(min: number, max: number): number
  /** Подбросить монетку с заданной вероятностью (0..1). */
  chance(p: number): boolean
}

function hashSeed(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 65599 + seed.charCodeAt(i)) >>> 0
  }
  return h === 0 ? 0xdeadbeef : h
}

export function createSeededRng(seed: string): SeededRng {
  let state = hashSeed(seed)

  function next(): number {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state
  }

  function float(): number {
    return next() / 0x100000000
  }

  return {
    float,
    int(min: number, max: number): number {
      return min + Math.floor(float() * (max - min + 1))
    },
    chance(p: number): boolean {
      return float() < p
    },
  }
}
