/**
 * Этап 3 — typed ports compatibility.
 *
 * Проверяет:
 *  - NODE_PORTS completeness (каждый NodeType описан).
 *  - checkPortCompatibility поведение для основных кейсов:
 *    happy-path domain-цепочки, loop pass-through hint, транспортные ноды,
 *    mismatch (target требует поле, source не отдаёт), неизвестные типы.
 */
import { describe, it, expect } from 'vitest'
import {
  NODE_TYPES,
  NODE_PORTS,
  checkPortCompatibility,
  isTransportNode,
  PIPELINE_PORTS_VERSION,
} from '../../shared/utils/pipeline-node-registry'

describe('NODE_PORTS completeness', () => {
  it.each(NODE_TYPES)('тип %s имеет запись в NODE_PORTS', (type) => {
    expect(NODE_PORTS[type]).toBeDefined()
    expect(Array.isArray(NODE_PORTS[type].inputs)).toBe(true)
    expect(Array.isArray(NODE_PORTS[type].outputs)).toBe(true)
  })

  it('PIPELINE_PORTS_VERSION экспортирован как number', () => {
    expect(typeof PIPELINE_PORTS_VERSION).toBe('number')
    expect(PIPELINE_PORTS_VERSION).toBeGreaterThan(0)
  })
})

describe('checkPortCompatibility — happy paths', () => {
  it('trendwatcher → scenario: ok (scenario ждёт trends:array, trendwatcher отдаёт)', () => {
    const r = checkPortCompatibility('trendwatcher', 'scenario')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('scenario → video: ok (video ждёт scenarios:array)', () => {
    const r = checkPortCompatibility('scenario', 'video')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('video → upload: ok (upload ждёт videos:array)', () => {
    const r = checkPortCompatibility('video', 'upload')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('video → caption_generator: ok (caption_generator ждёт videos:array, опционально)', () => {
    const r = checkPortCompatibility('video', 'caption_generator')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('http_request → notification: ok (notification принимает any)', () => {
    const r = checkPortCompatibility('http_request', 'notification')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })
})

describe('checkPortCompatibility — mismatches (warning, не блокирует)', () => {
  it('trendwatcher → video: warning (video ждёт scenarios, trendwatcher даёт trends)', () => {
    const r = checkPortCompatibility('trendwatcher', 'video')
    expect(r.compatible).toBe(false)
    expect(r.severity).toBe('warning')
    expect(r.reason).toContain('scenarios')
    expect(r.missingKeys).toContain('scenarios')
  })

  it('idea → scenario: warning (scenario ждёт trends, idea даёт ideas)', () => {
    const r = checkPortCompatibility('idea', 'scenario')
    expect(r.compatible).toBe(false)
    expect(r.severity).toBe('warning')
    expect(r.missingKeys).toContain('trends')
  })

  it('trendwatcher → upload: warning (upload ждёт videos)', () => {
    const r = checkPortCompatibility('trendwatcher', 'upload')
    expect(r.compatible).toBe(false)
    expect(r.severity).toBe('warning')
    expect(r.missingKeys).toContain('videos')
  })
})

describe('checkPortCompatibility — loop pass-through (special case)', () => {
  it('loop → scenario: compatible+warning (loop пробрасывает upstream)', () => {
    const r = checkPortCompatibility('loop', 'scenario')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('warning')
    expect(r.reason).toContain('upstream')
  })

  it('loop → video: compatible+warning (то же — pass-through)', () => {
    const r = checkPortCompatibility('loop', 'video')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('warning')
  })

  it('trendwatcher → loop: ok (loop принимает items:array опционально)', () => {
    // Loop input.items optional, поэтому даже trendwatcher без items проходит.
    const r = checkPortCompatibility('trendwatcher', 'loop')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })
})

describe('checkPortCompatibility — другие транспортные ноды', () => {
  it('set → scenario: ok (set pass-through, не проверяем)', () => {
    const r = checkPortCompatibility('set', 'scenario')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('wait → video: ok (wait pass-through)', () => {
    const r = checkPortCompatibility('wait', 'video')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('if_switch → upload: ok (if_switch pass-through)', () => {
    const r = checkPortCompatibility('if_switch', 'upload')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('filter → scenario: ok (filter pass-through)', () => {
    const r = checkPortCompatibility('filter', 'scenario')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('sub_pipeline → upload: ok (sub_pipeline pass-through, неизвестный shape)', () => {
    const r = checkPortCompatibility('sub_pipeline', 'upload')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })
})

describe('checkPortCompatibility — legacy / unknown types', () => {
  it('unknown source: ok без warning', () => {
    const r = checkPortCompatibility('xyz_legacy', 'scenario')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('unknown target: ok без warning', () => {
    const r = checkPortCompatibility('trendwatcher', 'xyz_legacy')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('пустые строки: ok (защита от пустого data.type)', () => {
    const r = checkPortCompatibility('', '')
    expect(r.compatible).toBe(true)
    expect(r.severity).toBe('ok')
  })

  it('note → scenario: warning (note ничего не отдаёт, scenario ждёт trends)', () => {
    // Note декларирует outputs=[], scenario.inputs.trends required → ожидаем warning.
    const r = checkPortCompatibility('note', 'scenario')
    expect(r.compatible).toBe(false)
    expect(r.severity).toBe('warning')
    expect(r.missingKeys).toContain('trends')
  })
})

describe('isTransportNode', () => {
  it('loop / wait / set / if_switch / filter / sub_pipeline — транспортные', () => {
    for (const t of ['loop', 'wait', 'set', 'if_switch', 'filter', 'sub_pipeline']) {
      expect(isTransportNode(t)).toBe(true)
    }
  })

  it('trendwatcher / scenario / video — НЕ транспортные', () => {
    for (const t of ['trendwatcher', 'scenario', 'video', 'upload']) {
      expect(isTransportNode(t)).toBe(false)
    }
  })

  it('unknown type — false', () => {
    expect(isTransportNode('xyz')).toBe(false)
    expect(isTransportNode('')).toBe(false)
  })
})
