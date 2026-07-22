import { describe, expect, it } from 'vitest'
import {
  getExpectedScenePlan,
  normalizeSceneCountStrategy,
  SCENE_BUDGET_LIMITS,
} from '../../shared/utils/scene-budget'

describe('scene budget', () => {
  it('models longform vertical videos as exactly nine 8-10 second scenes', () => {
    expect(SCENE_BUDGET_LIMITS.longform).toMatchObject({
      minScenes: 9,
      maxScenes: 9,
      minSec: 8,
      maxSec: 10,
    })
    expect(getExpectedScenePlan('longform')).toMatchObject({
      sceneCount: 9,
      avgDurationSec: 9,
      perSceneDurations: Array(9).fill(9),
    })
    expect(normalizeSceneCountStrategy('longform')).toBe('longform')
  })
})
