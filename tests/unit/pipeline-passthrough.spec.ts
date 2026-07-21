/**
 * Unit-тесты pipeline-passthrough helper'а.
 *
 * Контекст: Этап 2 рефакторинга — выносим pass-through логику control-flow нод
 * (loop, wait, set, if_switch, filter) в единый helper. Здесь — изоляция самого
 * хелпера от call-sites. Параллельно spec'и `pipeline-loop-executor` и
 * `pipeline-graph-executor-drift` проверяют интеграцию.
 */
import { describe, it, expect } from 'vitest'
import {
  withPassthrough,
  withPassthroughNoData,
  detectUpstreamNoData,
  getUpstreamNoDataReason,
} from '../../server/utils/pipeline-passthrough'

describe('withPassthrough', () => {
  it('мержит upstream input с overrides — сохраняет domain поля и системный context', () => {
    const r = withPassthrough(
      { trends: [{ id: 1 }, { id: 2 }], _runId: 5, _pipelineId: 7 },
      { items: [{ id: 1 }, { id: 2 }], totalItems: 2, currentIndex: 0 },
    )
    expect(r.trends).toEqual([{ id: 1 }, { id: 2 }])
    expect(r._runId).toBe(5)
    expect(r._pipelineId).toBe(7)
    expect(r.items).toEqual([{ id: 1 }, { id: 2 }])
    expect(r.totalItems).toBe(2)
    expect(r.currentIndex).toBe(0)
  })

  it('overrides побеждают при конфликте ключей', () => {
    const r = withPassthrough({ items: ['old'], custom: 'a' }, { items: ['new'], custom: 'b' })
    expect(r.items).toEqual(['new'])
    expect(r.custom).toBe('b')
  })

  it('пробрасывает _noData / _noDataReason / _domainStatus из input по умолчанию', () => {
    const r = withPassthrough(
      { _noData: true, _noDataReason: 'apify=0', _domainStatus: 'no_data' },
      { items: [] },
    )
    expect(r._noData).toBe(true)
    expect(r._noDataReason).toBe('apify=0')
    expect(r._domainStatus).toBe('no_data')
    expect(r.items).toEqual([])
  })

  it('overrides могут перезаписать _noData (caller-clearance pattern)', () => {
    // Случай: items.length>0 + upstream _noData. Если caller хочет очистить
    // _noData потому что данные есть — кладёт явный undefined/false в overrides.
    // По умолчанию withPassthrough НЕ маскирует upstream — это решение caller'а.
    const r = withPassthrough(
      { _noData: true, _noDataReason: 'x', items: [1] },
      { _noData: false, _noDataReason: undefined },
    )
    expect(r._noData).toBe(false)
    expect(r._noDataReason).toBeUndefined()
    expect(r.items).toEqual([1])
  })

  it('пустые overrides — output === merged input (контракт filter и идемпотент)', () => {
    const input = { trends: [1, 2], _runId: 9 }
    const r = withPassthrough(input, {})
    expect(r).toEqual(input)
    // shallow copy: новый объект, не та же ссылка
    expect(r).not.toBe(input)
  })
})

describe('withPassthroughNoData', () => {
  it('ставит _noData=true, _domainStatus=no_data и predпочитает upstream reason', () => {
    const r = withPassthroughNoData(
      { _noDataReason: 'Apify вернул 0 элементов' },
      { items: [] },
      'Пустой массив для итерации',
    )
    expect(r._noData).toBe(true)
    expect(r._domainStatus).toBe('no_data')
    expect(r._noDataReason).toBe('Apify вернул 0 элементов')
    expect(r.items).toEqual([])
  })

  it('использует overrideReason если upstream не дал _noDataReason', () => {
    const r = withPassthroughNoData(
      { _runId: 1 },
      { items: [], totalItems: 0 },
      'Пустой массив для итерации (поле "trends")',
    )
    expect(r._noData).toBe(true)
    expect(r._noDataReason).toBe('Пустой массив для итерации (поле "trends")')
    expect(r._runId).toBe(1)
    expect(r.totalItems).toBe(0)
  })

  it('пробрасывает domain поля и системный context на no-data ветке', () => {
    const r = withPassthroughNoData(
      {
        trends: [],
        _runId: 42,
        _pipelineId: 7,
        _nodeCanvasId: 'loop-1',
        _triggerType: 'manual',
        _pipelineName: 'Test',
      },
      { items: [], totalItems: 0, currentIndex: 0 },
      'Пустой массив',
    )
    expect(r._runId).toBe(42)
    expect(r._pipelineId).toBe(7)
    expect(r._nodeCanvasId).toBe('loop-1')
    expect(r._triggerType).toBe('manual')
    expect(r._pipelineName).toBe('Test')
    expect(r.trends).toEqual([])
  })

  it('игнорирует пустую строку и whitespace-only в input._noDataReason', () => {
    // Защита от мусора в input — попадаем на overrideReason.
    const r = withPassthroughNoData(
      { _noDataReason: '   ' },
      {},
      'Корректная причина',
    )
    expect(r._noDataReason).toBe('Корректная причина')
  })
})

describe('detectUpstreamNoData (regression — поведение должно совпасть с pipeline-executors.ts:16-18 до рефакторинга)', () => {
  it('true когда input._noData === true', () => {
    expect(detectUpstreamNoData({ _noData: true })).toBe(true)
  })

  it('true когда input._domainStatus === "no_data"', () => {
    expect(detectUpstreamNoData({ _domainStatus: 'no_data' })).toBe(true)
  })

  it('false для чистого input', () => {
    expect(detectUpstreamNoData({ trends: [{ id: 1 }] })).toBe(false)
  })

  it('false когда _noData != true (truthy не считается)', () => {
    expect(detectUpstreamNoData({ _noData: 'yes' })).toBe(false)
    expect(detectUpstreamNoData({ _noData: 1 })).toBe(false)
  })

  it('false когда _domainStatus !== "no_data"', () => {
    expect(detectUpstreamNoData({ _domainStatus: 'success' })).toBe(false)
    expect(detectUpstreamNoData({ _domainStatus: 'domain_degraded' })).toBe(false)
  })
})

describe('getUpstreamNoDataReason (regression — поведение должно совпасть с pipeline-executors.ts:23-27 до рефакторинга)', () => {
  it('возвращает явный _noDataReason если он непустая строка', () => {
    expect(getUpstreamNoDataReason({ _noDataReason: 'Apify вернул 0' })).toBe('Apify вернул 0')
  })

  it('undefined для пустой строки или whitespace', () => {
    expect(getUpstreamNoDataReason({ _noDataReason: '' })).toBeUndefined()
    expect(getUpstreamNoDataReason({ _noDataReason: '   ' })).toBeUndefined()
  })

  it('undefined для не-строки', () => {
    expect(getUpstreamNoDataReason({ _noDataReason: 123 })).toBeUndefined()
    expect(getUpstreamNoDataReason({ _noDataReason: null })).toBeUndefined()
    expect(getUpstreamNoDataReason({ _noDataReason: undefined })).toBeUndefined()
  })

  it('undefined когда поля нет', () => {
    expect(getUpstreamNoDataReason({ _noData: true })).toBeUndefined()
  })
})

describe('Edge case: items.length>0 + upstream _noData (drift safety)', () => {
  // Документация решения: withPassthrough ВСЕГДА пробрасывает upstream _noData.
  // Логика — мы НЕ маскируем грязное состояние. Caller (loop) различает по
  // len>0 vs len==0: на len>0 НЕ вызывает withPassthroughNoData, просто
  // withPassthrough, и upstream _noData проходит через ...input. Engine
  // или downstream domain-нода решит что с этим делать.
  it('withPassthrough(input, overrides) НЕ снимает _noData из input', () => {
    const r = withPassthrough(
      { items: [{ id: 1 }], _noData: true, _noDataReason: 'x', _domainStatus: 'no_data' },
      { totalItems: 1, currentIndex: 0 },
    )
    expect(r._noData).toBe(true)
    expect(r._noDataReason).toBe('x')
    expect(r._domainStatus).toBe('no_data')
    expect(r.items).toEqual([{ id: 1 }])
    expect(r.totalItems).toBe(1)
  })
})
