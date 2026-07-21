import { describe, it, expect } from 'vitest'
import { buildEdgeSnapshot } from '../../server/utils/pipeline-edge-snapshot'

describe('buildEdgeSnapshot', () => {
  it('собирает верхнеуровневые ключи output по каждому incoming edge', () => {
    const outputs = new Map<string, unknown>([
      ['n1', { trends: [1, 2], _runId: 5, _pipelineId: 7 }],
      ['n2', { videos: [], generatedCount: 0 }],
    ])
    const edges = [
      { source: 'n1', target: 'n3' },
      { source: 'n2', target: 'n3' },
    ]
    const snap = buildEdgeSnapshot('n3', edges, outputs)
    expect(snap).toEqual({
      n1: ['trends', '_runId', '_pipelineId'],
      n2: ['videos', 'generatedCount'],
    })
  })

  it('пустые edges → null', () => {
    expect(buildEdgeSnapshot('x', [], new Map())).toBeNull()
  })

  it('incoming edges есть, но ни у одного upstream нет output → null', () => {
    const snap = buildEdgeSnapshot(
      'n2',
      [{ source: 'n1', target: 'n2' }],
      new Map(),
    )
    expect(snap).toBeNull()
  })

  it('системные ключи (_noData, _runId) включаются в snapshot', () => {
    const outputs = new Map<string, unknown>([
      ['loop-1', {
        items: [],
        totalItems: 0,
        currentIndex: 0,
        _noData: true,
        _noDataReason: 'Пустой массив',
        _domainStatus: 'no_data',
        _runId: 42,
      }],
    ])
    const snap = buildEdgeSnapshot(
      'scenario-1',
      [{ source: 'loop-1', target: 'scenario-1' }],
      outputs,
    )
    expect(snap).not.toBeNull()
    expect(snap!['loop-1']).toContain('_noData')
    expect(snap!['loop-1']).toContain('_noDataReason')
    expect(snap!['loop-1']).toContain('_runId')
    expect(snap!['loop-1']).toContain('items')
  })

  it('output upstream это null/string/number → пустой массив для этого источника', () => {
    const outputs = new Map<string, unknown>([
      ['filter-1', null as unknown],
      ['set-1', 'just a string'],
      ['code-1', 42],
    ])
    const edges = [
      { source: 'filter-1', target: 'n1' },
      { source: 'set-1', target: 'n1' },
      { source: 'code-1', target: 'n1' },
    ]
    const snap = buildEdgeSnapshot('n1', edges, outputs)
    expect(snap).toEqual({
      'filter-1': [],
      'set-1': [],
      'code-1': [],
    })
  })

  it('output upstream — массив → пустой массив (top-level keys у массива не семантичны)', () => {
    const outputs = new Map<string, unknown>([
      ['code-1', [1, 2, 3]],
    ])
    const snap = buildEdgeSnapshot(
      'n2',
      [{ source: 'code-1', target: 'n2' }],
      outputs,
    )
    expect(snap).toEqual({ 'code-1': [] })
  })

  it('upstream не в outputs Map (ещё не выполнен / скипнут) — источник опускается', () => {
    const outputs = new Map<string, unknown>([
      ['n1', { trends: [] }],
    ])
    const edges = [
      { source: 'n1', target: 'n3' },
      { source: 'n2', target: 'n3' }, // n2 нет в outputs
    ]
    const snap = buildEdgeSnapshot('n3', edges, outputs)
    expect(snap).toEqual({ n1: ['trends'] })
    expect(snap).not.toHaveProperty('n2')
  })

  it('_edgeSnapshot из upstream output фильтруется (не пробрасывается рекурсивно)', () => {
    const outputs = new Map<string, unknown>([
      ['loop-1', {
        items: [1],
        _runId: 5,
        _edgeSnapshot: { 'trendwatcher-1': ['trends'] }, // загрязнение от прошлого hop
      }],
    ])
    const snap = buildEdgeSnapshot(
      'scenario-1',
      [{ source: 'loop-1', target: 'scenario-1' }],
      outputs,
    )
    expect(snap!['loop-1']).toContain('items')
    expect(snap!['loop-1']).toContain('_runId')
    expect(snap!['loop-1']).not.toContain('_edgeSnapshot')
  })

  it('игнорирует edges где target не равен запрошенному nodeId', () => {
    const outputs = new Map<string, unknown>([
      ['n1', { a: 1 }],
      ['n2', { b: 2 }],
    ])
    const edges = [
      { source: 'n1', target: 'n3' },
      { source: 'n2', target: 'n4' }, // другая нода
    ]
    const snap = buildEdgeSnapshot('n3', edges, outputs)
    expect(snap).toEqual({ n1: ['a'] })
  })
})
