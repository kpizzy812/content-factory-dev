/**
 * Unit-тесты для regenerateCharacterBlock (Этап 5 scene-driven path refactor).
 *
 * Стратегия: ANTHROPIC_MOCK_MODE=true → callAnthropicAgent загружает фикстуру по
 * agentName (character-block-description / character-block-visual-prompt). Реального
 * HTTP-вызова нет.
 *
 * Покрытие:
 *  - blockType='description' возвращает строку (russian, длина > 0).
 *  - blockType='visualPrompt' возвращает строку (english 1-liner).
 *  - reason и referenceDescriptions передаются без падения (smoke).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { regenerateCharacterBlock } from '../../server/utils/agents/character-block-regenerator'

const ORIGINAL_MOCK_FLAG = process.env.ANTHROPIC_MOCK_MODE
beforeAll(() => { process.env.ANTHROPIC_MOCK_MODE = 'true' })
afterAll(() => {
  if (ORIGINAL_MOCK_FLAG === undefined) delete process.env.ANTHROPIC_MOCK_MODE
  else process.env.ANTHROPIC_MOCK_MODE = ORIGINAL_MOCK_FLAG
})

const baseChar = {
  name: 'Алекс',
  description: 'Старое описание',
  visualPrompt: 'old visual prompt',
  role: 'protagonist',
  ageRange: '28-32',
  emotionDefault: 'curious',
  tags: ['fitness'],
}
const baseApp = { name: 'TestApp', description: 'app description' }

describe('regenerateCharacterBlock', () => {
  it('description возвращает строку > 0 длины', async () => {
    const result = await regenerateCharacterBlock({
      character: baseChar,
      app: baseApp,
      blockType: 'description',
    })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(10)
  })

  it('visualPrompt возвращает строку > 0 длины', async () => {
    const result = await regenerateCharacterBlock({
      character: baseChar,
      app: baseApp,
      blockType: 'visualPrompt',
    })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(10)
  })

  it('reason передаётся без падения', async () => {
    const result = await regenerateCharacterBlock({
      character: baseChar,
      app: baseApp,
      blockType: 'description',
      reason: 'добавь упоминание татуировки',
    })
    expect(typeof result).toBe('string')
  })

  it('referenceDescriptions передаются без падения', async () => {
    const result = await regenerateCharacterBlock({
      character: baseChar,
      app: baseApp,
      blockType: 'visualPrompt',
      referenceDescriptions: [
        '30y athletic male, short brown hair, beard, black t-shirt',
        'arm tattoo visible, kind smile',
      ],
    })
    expect(typeof result).toBe('string')
  })

  it('возвращает trim()-ed строку (без leading/trailing whitespace)', async () => {
    const result = await regenerateCharacterBlock({
      character: baseChar,
      app: baseApp,
      blockType: 'description',
    })
    expect(result).toBe(result.trim())
  })
})
