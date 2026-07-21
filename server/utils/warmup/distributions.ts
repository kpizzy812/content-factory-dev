/**
 * Распределения action'ов и длительностей для warmup-планов.
 *
 * Ключ ACTION_DISTRIBUTIONS — `${platform}_${ageBucket}` (9 ключей: tiktok/youtube/instagram × new/warming/mature).
 *
 * Веса в распределении нормализованы на 1.0, но weightedPick принимает любые суммы.
 *
 * Длительности (sec): описаны в ACTION_DURATIONS как [min, max]. RNG.int() выберет случайное целое
 * в диапазоне.
 *
 * BUCKET_TARGET_DURATION: целевая суммарная длительность по бакету (секунды).
 * Planner крутит цикл `accumulated < target - 5` с jitter ±15%.
 */

import type { WarmupActionKind, AccountAgeBucket, WarmupPlatform } from "~~/shared/types/warmup"
import type { SeededRng } from "./rng"

export interface ActionWeight {
  kind: WarmupActionKind
  weight: number
}

type DistributionKey = `${WarmupPlatform}_${AccountAgeBucket}`

export const ACTION_DISTRIBUTIONS: Record<DistributionKey, readonly ActionWeight[]> = {
  tiktok_new: [
    { kind: "view", weight: 0.85 },
    { kind: "scroll", weight: 0.15 },
  ],
  tiktok_warming: [
    { kind: "view", weight: 0.55 },
    { kind: "scroll", weight: 0.20 },
    { kind: "like", weight: 0.18 },
    { kind: "follow", weight: 0.05 },
    { kind: "save", weight: 0.02 },
  ],
  tiktok_mature: [
    { kind: "view", weight: 0.40 },
    { kind: "scroll", weight: 0.15 },
    { kind: "like", weight: 0.25 },
    { kind: "follow", weight: 0.08 },
    { kind: "comment", weight: 0.05 },
    { kind: "share", weight: 0.04 },
    { kind: "save", weight: 0.03 },
  ],
  youtube_new: [
    { kind: "view", weight: 0.90 },
    { kind: "scroll", weight: 0.10 },
  ],
  youtube_warming: [
    { kind: "view", weight: 0.65 },
    { kind: "scroll", weight: 0.15 },
    { kind: "like", weight: 0.15 },
    { kind: "follow", weight: 0.05 },
  ],
  youtube_mature: [
    { kind: "view", weight: 0.50 },
    { kind: "scroll", weight: 0.10 },
    { kind: "like", weight: 0.22 },
    { kind: "follow", weight: 0.08 },
    { kind: "comment", weight: 0.06 },
    { kind: "share", weight: 0.04 },
  ],
  instagram_new: [
    { kind: "view", weight: 0.80 },
    { kind: "scroll", weight: 0.20 },
  ],
  instagram_warming: [
    { kind: "view", weight: 0.50 },
    { kind: "scroll", weight: 0.25 },
    { kind: "like", weight: 0.18 },
    { kind: "follow", weight: 0.05 },
    { kind: "save", weight: 0.02 },
  ],
  instagram_mature: [
    { kind: "view", weight: 0.40 },
    { kind: "scroll", weight: 0.18 },
    { kind: "like", weight: 0.25 },
    { kind: "follow", weight: 0.07 },
    { kind: "comment", weight: 0.05 },
    { kind: "share", weight: 0.02 },
    { kind: "save", weight: 0.03 },
  ],
}

/** Длительность action'а в секундах: [min, max] включительно. */
export const ACTION_DURATIONS: Record<WarmupActionKind, readonly [number, number]> = {
  view: [5, 60],
  scroll: [3, 10],
  like: [1, 3],
  follow: [2, 5],
  comment: [8, 20],
  share: [2, 4],
  save: [1, 2],
}

/** Целевая суммарная длительность в секундах по бакету. */
export const BUCKET_TARGET_DURATION: Record<AccountAgeBucket, number> = {
  new: 600, // 10 минут
  warming: 1200, // 20 минут
  mature: 1800, // 30 минут
}

/** Максимальная длительность одного action'а — для проверки tolerance в smoke test. */
export const MAX_SINGLE_ACTION_DURATION_SEC = 60

export function getDistributionKey(
  platform: WarmupPlatform,
  bucket: AccountAgeBucket,
): DistributionKey {
  return `${platform}_${bucket}` as DistributionKey
}

export function getDistribution(
  platform: WarmupPlatform,
  bucket: AccountAgeBucket,
): readonly ActionWeight[] {
  return ACTION_DISTRIBUTIONS[getDistributionKey(platform, bucket)]
}

export function getActionDuration(rng: SeededRng, kind: WarmupActionKind): number {
  const [min, max] = ACTION_DURATIONS[kind]
  return rng.int(min, max)
}
