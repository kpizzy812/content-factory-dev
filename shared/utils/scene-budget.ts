/**
 * Бюджет сценария — единый источник истины для:
 *   - server/utils/agents/scene-planner-agent.ts (валидация количества сцен и длительности)
 *   - server/api/pipelines/[id]/nodes/[nodeId]/upstream-context.get.ts (estimate для UI)
 *   - app/components/pipeline/config/VideoConfig.vue (мгновенная синхронизация без API)
 *
 * Pure-логика, без I/O — поэтому в shared/, не в server/.
 */

// SceneCountStrategy экспортируется из shared/types/scenario.ts — единый источник.
// Здесь только импорт для типизации SCENE_BUDGET_LIMITS / getExpectedScenePlan.
import type { SceneCountStrategy } from '~~/shared/types/scenario'

export interface SceneBudgetLimit {
  minScenes: number
  maxScenes: number
  minSec: number
  maxSec: number
  /** Человекочитаемая суммарная характеристика (пример «15-25 секунд (~$2)»). Используется в UI. */
  totalSec: string
}

/**
 * Жёсткие диапазоны количества сцен и длительности на сцену для каждой стратегии.
 * Используются для ограничения стоимости видео на этапе сценария.
 */
export const SCENE_BUDGET_LIMITS: Record<SceneCountStrategy, SceneBudgetLimit> = {
  minimal:   { minScenes: 3, maxScenes: 3, minSec: 3, maxSec: 4, totalSec: '9-12 секунд (дешёвое видео, ~$1)' },
  auto:      { minScenes: 3, maxScenes: 5, minSec: 3, maxSec: 6, totalSec: '15-25 секунд (стандарт, ~$2)' },
  detailed:  { minScenes: 4, maxScenes: 5, minSec: 4, maxSec: 7, totalSec: '20-35 секунд (проработано, ~$2.5-3.5)' },
  cinematic: { minScenes: 5, maxScenes: 6, minSec: 6, maxSec: 9, totalSec: '30-55 секунд (максимум, ~$4-5)' },
  longform:  { minScenes: 9, maxScenes: 9, minSec: 8, maxSec: 10, totalSec: '72-90 секунд (длинный Reels/Shorts)' },
}

export interface ExpectedScenePlan {
  sceneCount: number
  avgDurationSec: number
  perSceneDurations: number[]
  totalSec: string
}

/**
 * Возвращает ожидаемый план сцен (середина диапазона) для выбранной стратегии.
 * Используется в UI до запуска реального scene-planner'а — для honest estimate
 * стоимости в video-блоке.
 */
export function getExpectedScenePlan(strategy: SceneCountStrategy | string): ExpectedScenePlan {
  const budget = SCENE_BUDGET_LIMITS[strategy as SceneCountStrategy] ?? SCENE_BUDGET_LIMITS.auto
  const sceneCount = Math.round((budget.minScenes + budget.maxScenes) / 2)
  const avgDurationSec = Math.round((budget.minSec + budget.maxSec) / 2)
  const perSceneDurations = Array.from({ length: sceneCount }, () => avgDurationSec)
  return { sceneCount, avgDurationSec, perSceneDurations, totalSec: budget.totalSec }
}

/**
 * Подгружаемая стратегия из node config'а — нормализует к допустимому значению.
 * Гарантирует, что вне-словарные значения (legacy / битый JSON) не сломают UI.
 */
export function normalizeSceneCountStrategy(raw: unknown): SceneCountStrategy {
  if (typeof raw === 'string' && raw in SCENE_BUDGET_LIMITS) {
    return raw as SceneCountStrategy
  }
  return 'auto'
}
