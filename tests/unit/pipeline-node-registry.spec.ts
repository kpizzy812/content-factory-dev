/**
 * Drift-тесты единого реестра типов нод.
 *
 * Проверяет:
 *   1. Каждый тип из реестра имеет UI-метаданные (label, description, icon).
 *   2. Каждый тип реестра распознаётся валидатором (никогда не выдаёт
 *      issue с code='unknown_node_type').
 *
 * Эти тесты ловят рассинхрон между серверной валидацией и UI-каталогом
 * (раньше caption_generator/google_drive_scanner/video_analyzer были в
 * UI/executor, но не в KNOWN_NODE_TYPES — поэтому валидатор блокировал
 * запуск с ошибкой «Неизвестный тип ноды»).
 */
import { describe, expect, it } from 'vitest'
import { NODE_TYPES, isKnownNodeType } from '../../shared/utils/pipeline-node-registry'
import {
  nodeTypeLabels,
  nodeTypeDescriptions,
  nodeTypeIcons,
} from '../../app/utils/pipeline-node-meta'
import { validateGraphQuick } from '../../server/utils/pipeline-validator'

describe('pipeline-node-registry: UI-meta полнота', () => {
  it.each(NODE_TYPES)('тип %s имеет nodeTypeLabels', (type) => {
    expect(nodeTypeLabels[type]).toBeTruthy()
  })

  it.each(NODE_TYPES)('тип %s имеет nodeTypeDescriptions', (type) => {
    expect(nodeTypeDescriptions[type]).toBeTruthy()
  })

  it.each(NODE_TYPES)('тип %s имеет nodeTypeIcons', (type) => {
    expect(nodeTypeIcons[type]).toBeTruthy()
  })
})

describe('pipeline-node-registry: isKnownNodeType', () => {
  it('возвращает true для всех типов из реестра', () => {
    for (const t of NODE_TYPES) {
      expect(isKnownNodeType(t)).toBe(true)
    }
  })

  it('возвращает false для неизвестных строк', () => {
    expect(isKnownNodeType('unknown_xyz')).toBe(false)
    expect(isKnownNodeType('')).toBe(false)
    expect(isKnownNodeType('TRENDWATCHER')).toBe(false)
  })
})

describe('pipeline-node-registry: validator признаёт каждый тип', () => {
  it.each(NODE_TYPES)(
    'тип %s не вызывает code=unknown_node_type у validateGraphQuick',
    (type) => {
      const issues = validateGraphQuick(
        [{ id: 'n1', data: { type, config: {} } }],
        [],
      )
      // Допускаем другие issue (missing required fields, range warnings и т.п.).
      // Нас интересует ровно одно: тип распознан.
      const hasUnknown = issues.some(i => i.code === 'unknown_node_type')
      expect(hasUnknown).toBe(false)
    },
  )
})
