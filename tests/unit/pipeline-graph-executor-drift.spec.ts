/**
 * Drift-тест: список типов в реестре ↔ список case'ов в executeNode.
 *
 * EXECUTOR_HANDLED_TYPES — ручное зеркало switch'а в `executeNode` (см.
 * `server/utils/pipeline-graph.ts`). Если разработчик добавил `case 'foo'`
 * в switch, но забыл `'foo'` в реестре (или наоборот) — этот тест падает.
 */
import { describe, expect, it } from 'vitest'
import { NODE_TYPES } from '../../shared/utils/pipeline-node-registry'
import { EXECUTOR_HANDLED_TYPES } from '../../server/utils/pipeline-graph'

describe('pipeline-graph executor ↔ registry drift', () => {
  it('EXECUTOR_HANDLED_TYPES совпадает с NODE_TYPES (как множества)', () => {
    const fromExecutor = new Set(EXECUTOR_HANDLED_TYPES)
    const fromRegistry = new Set(NODE_TYPES)
    expect(fromExecutor).toEqual(fromRegistry)
  })

  it('в EXECUTOR_HANDLED_TYPES нет дубликатов', () => {
    expect(new Set(EXECUTOR_HANDLED_TYPES).size).toBe(EXECUTOR_HANDLED_TYPES.length)
  })

  it('в NODE_TYPES нет дубликатов', () => {
    expect(new Set(NODE_TYPES).size).toBe(NODE_TYPES.length)
  })
})
