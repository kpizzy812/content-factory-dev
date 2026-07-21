/**
 * Unit-тесты для regenerateSceneBlockAI (Этап 4 scene-driven path refactor).
 *
 * Стратегия: ANTHROPIC_MOCK_MODE=true → callAnthropicAgent грузит фикстуру
 * по agentName (scene-block-action / scene-block-style / scene-block-environment).
 * Реального HTTP-запроса нет.
 *
 * Покрытие:
 *  - regenerable kinds (action/style/environment) возвращают правильную форму блока.
 *  - non-regenerable kinds (character/app_screen/app_context) выбрасывают Error.
 *  - id блока сохраняется.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { regenerateSceneBlockAI } from '../../server/utils/agents/scene-block-regenerator'
import type { SceneBlock } from '../../shared/types/scene'

const ORIGINAL_MOCK_FLAG = process.env.ANTHROPIC_MOCK_MODE
beforeAll(() => { process.env.ANTHROPIC_MOCK_MODE = 'true' })
afterAll(() => {
  if (ORIGINAL_MOCK_FLAG === undefined) delete process.env.ANTHROPIC_MOCK_MODE
  else process.env.ANTHROPIC_MOCK_MODE = ORIGINAL_MOCK_FLAG
})

describe('regenerateSceneBlockAI', () => {
  const baseScene = { name: 'Test Scene', description: 'desc', tags: ['t1'] }
  const baseApp = { name: 'TestApp', description: 'app description' }

  it('возвращает блок action с description (из фикстуры)', async () => {
    const block: SceneBlock = { id: 'blk_1', kind: 'action', description: 'old action' }
    const result = await regenerateSceneBlockAI({ block, scene: baseScene, app: baseApp })
    expect(result.kind).toBe('action')
    expect(result.id).toBe('blk_1')
    if (result.kind === 'action') {
      expect(result.description.length).toBeGreaterThan(0)
    }
  })

  it('возвращает блок style с visualStyle (из фикстуры)', async () => {
    const block: SceneBlock = { id: 'blk_s', kind: 'style', visualStyle: 'old style' }
    const result = await regenerateSceneBlockAI({ block, scene: baseScene, app: baseApp })
    expect(result.kind).toBe('style')
    expect(result.id).toBe('blk_s')
    if (result.kind === 'style') {
      expect(result.visualStyle.length).toBeGreaterThan(0)
    }
  })

  it('возвращает блок environment с location (из фикстуры)', async () => {
    const block: SceneBlock = { id: 'blk_e', kind: 'environment', location: 'old place' }
    const result = await regenerateSceneBlockAI({ block, scene: baseScene, app: baseApp })
    expect(result.kind).toBe('environment')
    expect(result.id).toBe('blk_e')
    if (result.kind === 'environment') {
      expect(result.location.length).toBeGreaterThan(0)
    }
  })

  it('сохраняет id блока после регенерации (для всех kinds)', async () => {
    const blocks: SceneBlock[] = [
      { id: 'id-act', kind: 'action', description: 'x' },
      { id: 'id-stl', kind: 'style', visualStyle: 'x' },
      { id: 'id-env', kind: 'environment', location: 'x' },
    ]
    for (const b of blocks) {
      const r = await regenerateSceneBlockAI({ block: b, scene: baseScene, app: baseApp })
      expect(r.id).toBe(b.id)
    }
  })

  it('падает Error для non-regenerable kind (character)', async () => {
    const block: SceneBlock = { id: 'c1', kind: 'character', characterId: 'char-1' }
    await expect(
      regenerateSceneBlockAI({ block, scene: baseScene, app: baseApp }),
    ).rejects.toThrow(/Регенерация недоступна/)
  })

  it('падает Error для non-regenerable kind (app_screen)', async () => {
    const block: SceneBlock = { id: 'as1', kind: 'app_screen', referenceImageId: 'ref-1' }
    await expect(
      regenerateSceneBlockAI({ block, scene: baseScene, app: baseApp }),
    ).rejects.toThrow(/Регенерация недоступна/)
  })

  it('падает Error для non-regenerable kind (app_context)', async () => {
    const block: SceneBlock = { id: 'ac1', kind: 'app_context', focus: 'value-prop' }
    await expect(
      regenerateSceneBlockAI({ block, scene: baseScene, app: baseApp }),
    ).rejects.toThrow(/Регенерация недоступна/)
  })

  it('reason передаётся в промпт (smoke: вызов не падает с reason)', async () => {
    const block: SceneBlock = { id: 'blk_r', kind: 'action', description: 'x' }
    const r = await regenerateSceneBlockAI({
      block,
      scene: baseScene,
      app: baseApp,
      reason: 'сделай больше движения',
      otherBlocks: [
        { id: 'os-1', kind: 'style', visualStyle: 'cinematic' },
      ],
    })
    expect(r.kind).toBe('action')
  })
})
