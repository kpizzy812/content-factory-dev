/**
 * Детерминистический генератор планов прогрева.
 *
 * Вход: account info + scheduledAt + keywordPool + commentLanguage.
 * Выход: WarmupPlan { meta, actions[] }.
 *
 * Алгоритм:
 *   1. Создаём seed = `${accountId}:${YYYY-MM-DD}` и SeededRng.
 *   2. Берём distribution[platform_bucket] и applyJitter ±15% к target duration.
 *   3. Цикл: пока accumulated < target - 5:
 *        a. weightedPick(distribution) → kind
 *        b. getActionDuration(rng, kind) → durationSec
 *        c. Создаём action с дополнительными полями (keyword/text/...)
 *        d. push в actions, accumulated += durationSec
 *   4. Возвращаем WarmupPlan.
 *
 * Безопасность по длительности:
 *   - Жёсткий лимит на число итераций (MAX_ACTIONS = 500), чтобы избежать бесконечного цикла
 *     при странных distribution'ах с весами 0.
 */

import type {
  AccountAgeBucket,
  WarmupAction,
  WarmupPlan,
  WarmupPlanMeta,
  WarmupPlatform,
} from "~~/shared/types/warmup"
import { pickComment } from "./comment-pool"
import { BUCKET_TARGET_DURATION, getActionDuration, getDistribution } from "./distributions"
import { createSeededRng, weightedPick, type SeededRng } from "./rng"

export interface GenerateWarmupPlanInput {
  socialAccountId: number
  platform: WarmupPlatform
  ageBucket: AccountAgeBucket
  /** Запланированное время начала сессии. Используется для dayKey/seed. */
  scheduledAt: Date
  /** Ключевые слова для view/scroll/follow. Гарантированно непустой (загрузчик подставит fallback). */
  keywordPool: string[]
  /** Язык для пика comment.text. */
  commentLanguage: string
  /** Опциональный override целевой длительности (для preview с кастомным targetDurationMinutes). */
  targetDurationSecOverride?: number
}

export const MAX_ACTIONS_PER_PLAN = 500
export const JITTER_RANGE = 0.15

/**
 * Формирует dayKey формата 'YYYY-MM-DD' из ISO даты по UTC.
 */
export function buildDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function buildSeed(accountId: number, date: Date): string {
  return `${accountId}:${buildDayKey(date)}`
}

function applyJitter(target: number, rng: SeededRng): number {
  // Целевая длительность ± JITTER_RANGE (детерминированно от rng)
  const factor = 1 + (rng.float() * 2 - 1) * JITTER_RANGE
  return Math.round(target * factor)
}

function pickKeyword(rng: SeededRng, pool: string[]): string {
  if (pool.length === 0) return "fyp"
  return pool[rng.int(0, pool.length - 1)]!
}

/**
 * Сборка одиночного action'а по типу.
 * Index проставляется на стороне вызывающего цикла.
 */
function buildAction(
  index: number,
  kind: WarmupAction["kind"],
  durationSec: number,
  rng: SeededRng,
  ctx: { keywordPool: string[]; commentLanguage: string },
): WarmupAction {
  switch (kind) {
    case "view":
      return {
        index,
        kind: "view",
        durationSec,
        keyword: pickKeyword(rng, ctx.keywordPool),
      }
    case "scroll":
      return {
        index,
        kind: "scroll",
        durationSec,
        itemCount: rng.int(2, 6),
      }
    case "like":
      return { index, kind: "like", durationSec }
    case "follow":
      return {
        index,
        kind: "follow",
        durationSec,
        targetCategory: pickKeyword(rng, ctx.keywordPool),
      }
    case "comment":
      return {
        index,
        kind: "comment",
        durationSec,
        text: pickComment(rng, ctx.commentLanguage),
        language: ctx.commentLanguage,
      }
    case "share":
      return { index, kind: "share", durationSec }
    case "save":
      return { index, kind: "save", durationSec }
  }
}

export function generateWarmupPlan(input: GenerateWarmupPlanInput): WarmupPlan {
  const seed = buildSeed(input.socialAccountId, input.scheduledAt)
  const rng = createSeededRng(seed)
  const distribution = getDistribution(input.platform, input.ageBucket)

  const baseTarget =
    input.targetDurationSecOverride && input.targetDurationSecOverride > 0
      ? input.targetDurationSecOverride
      : BUCKET_TARGET_DURATION[input.ageBucket]
  const jitteredTarget = applyJitter(baseTarget, rng)
  // Целимся в окно [target - 5, target + maxActionDuration] секунд.
  const cutoff = Math.max(jitteredTarget - 5, 0)

  const actions: WarmupAction[] = []
  let accumulated = 0
  let safety = 0

  while (accumulated < cutoff && safety < MAX_ACTIONS_PER_PLAN) {
    safety++
    const kind = weightedPick(rng, distribution).kind
    const durationSec = getActionDuration(rng, kind)
    const action = buildAction(actions.length, kind, durationSec, rng, {
      keywordPool: input.keywordPool,
      commentLanguage: input.commentLanguage,
    })
    actions.push(action)
    accumulated += durationSec
  }

  const meta: WarmupPlanMeta = {
    socialAccountId: input.socialAccountId,
    platform: input.platform,
    ageBucket: input.ageBucket,
    commentLanguage: input.commentLanguage,
    seed,
    targetDurationSec: jitteredTarget,
    totalDurationSec: accumulated,
    actionCount: actions.length,
    keywordPoolSize: input.keywordPool.length,
    generatedAt: new Date().toISOString(),
  }

  return { meta, actions }
}
