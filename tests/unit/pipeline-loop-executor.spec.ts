/**
 * Unit-тесты executeLoopNode — pass-through контракт + _noData propagation.
 *
 * Контекст: до фикса loop возвращал только { items, totalItems, currentIndex }
 * и стирал upstream поля (trends, _runId, _pipelineId, ...). Это ломало
 * trendwatcher → loop → scenario: scenario видел пустой input.trends.
 */
import { describe, it, expect } from 'vitest'
import { executeLoopNode } from '../../server/utils/pipeline-executors-extra'

describe('executeLoopNode pass-through', () => {
  it('пробрасывает upstream поля (trends, _runId, _pipelineId) и аннотирует items', async () => {
    const input = {
      trends: [{ id: 1, title: 't' }, { id: 2, title: 't2' }],
      _runId: 42,
      _pipelineId: 7,
      _nodeCanvasId: 'loop-1',
    }
    const out = await executeLoopNode({ arrayField: 'trends' }, input)
    expect(out.trends).toEqual(input.trends)
    expect(out._runId).toBe(42)
    expect(out._pipelineId).toBe(7)
    expect(out.items).toEqual(input.trends)
    expect(out.totalItems).toBe(2)
    expect(out.currentIndex).toBe(0)
    expect(out._noData).toBeUndefined()
    expect(out._noDataReason).toBeUndefined()
  })

  it('пустой массив → loop сам сигналит _noData с правильным reason (упоминание arrayField)', async () => {
    const out = await executeLoopNode({ arrayField: 'trends' }, { trends: [], _runId: 1 })
    expect(out._noData).toBe(true)
    expect(typeof out._noDataReason).toBe('string')
    expect(out._noDataReason).toContain('Пустой массив')
    expect(out._noDataReason).toContain('trends')
    expect(out._domainStatus).toBe('no_data')
    expect(out._runId).toBe(1) // pass-through сохранён даже на no-data ветке
    expect(out.items).toEqual([])
    expect(out.totalItems).toBe(0)
  })

  it('upstream уже сигналил _noData → пробрасываем upstream reason без перезаписи', async () => {
    const input = {
      trends: [],
      _noData: true,
      _noDataReason: 'Apify вернул 0 элементов',
      _domainStatus: 'no_data',
      _runId: 1,
    }
    const out = await executeLoopNode({ arrayField: 'trends' }, input)
    expect(out._noData).toBe(true)
    expect(out._noDataReason).toBe('Apify вернул 0 элементов')
    expect(out._domainStatus).toBe('no_data')
  })

  it('массив не пустой → не сигналит собственный _noData (output чистый по no-data)', async () => {
    const input = {
      trends: [{ id: 1 }],
      _runId: 5,
      _pipelineId: 9,
    }
    const out = await executeLoopNode({ arrayField: 'trends' }, input)
    expect(out._noData).toBeUndefined()
    expect(out._noDataReason).toBeUndefined()
    expect(out._domainStatus).toBeUndefined()
    expect(out.totalItems).toBe(1)
  })

  it('кастомный arrayField (scenarios) корректно читается, fallback на items если поля нет', async () => {
    const out1 = await executeLoopNode({ arrayField: 'scenarios' }, { scenarios: [{ id: 'a' }, { id: 'b' }] })
    expect(out1.items).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(out1.totalItems).toBe(2)

    // arrayField указан, но поля нет → fallback на input.items
    const out2 = await executeLoopNode({ arrayField: 'nonexistent' }, { items: ['a'] })
    expect(out2.items).toEqual(['a'])
    expect(out2.totalItems).toBe(1)

    // default arrayField='items'
    const out3 = await executeLoopNode({}, { items: [1, 2, 3], _runId: 1 })
    expect(out3.items).toEqual([1, 2, 3])
    expect(out3.totalItems).toBe(3)
    expect(out3._runId).toBe(1)
  })

  it('системные ключи (_pipelineId, _runId, _triggerType, _nodeCanvasId, _pipelineName) пробрасываются', async () => {
    const input = {
      trends: [{ id: 1 }],
      _runId: 100,
      _pipelineId: 50,
      _triggerType: 'manual',
      _nodeCanvasId: 'loop-xyz',
      _pipelineName: 'Test pipeline',
    }
    const out = await executeLoopNode({ arrayField: 'trends' }, input)
    expect(out._runId).toBe(100)
    expect(out._pipelineId).toBe(50)
    expect(out._triggerType).toBe('manual')
    expect(out._nodeCanvasId).toBe('loop-xyz')
    expect(out._pipelineName).toBe('Test pipeline')
  })
})
