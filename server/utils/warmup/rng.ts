/**
 * Seedable RNG для детерминистической генерации warmup-планов.
 *
 * XorShift32: простой быстрый PRNG, достаточно равномерный для наших нужд
 * (выбор взвешенных action'ов, длительность из диапазона).
 *
 * Вход seed — строка вида 'accountId:YYYY-MM-DD'. Хешируется в uint32 простым
 * sdbm (стабильно между Node и браузером, хотя браузер нам и не нужен).
 *
 * Гарантия: createSeededRng(seed) → одинаковая последовательность вызовов
 * .float()/.int(...) → одинаковый результат.
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
  // Защита от seed=0 (XorShift с нулём остаётся в нуле)
  return h === 0 ? 0xdeadbeef : h
}

export function createSeededRng(seed: string): SeededRng {
  let state = hashSeed(seed)

  function next(): number {
    // XorShift32: классический набор сдвигов
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
      if (max < min) [min, max] = [max, min]
      const span = max - min + 1
      return min + Math.floor(float() * span)
    },
    chance(p: number): boolean {
      return float() < p
    },
  }
}

/**
 * Взвешенный выбор из списка опций.
 * options[i].weight — относительный вес. Сумма не обязательно равна 1.
 */
export function weightedPick<T extends { weight: number }>(
  rng: SeededRng,
  options: readonly T[],
): T {
  if (options.length === 0) {
    throw new Error("weightedPick: пустой список опций")
  }
  let total = 0
  for (const o of options) total += o.weight
  if (total <= 0) {
    // Все веса нулевые — fallback на равномерный выбор
    return options[rng.int(0, options.length - 1)]!
  }
  let r = rng.float() * total
  for (const o of options) {
    r -= o.weight
    if (r <= 0) return o
  }
  return options[options.length - 1]!
}
