import { describe, expect, it } from 'vitest'
import { getPresetById, pipelinePresets } from '../../../shared/utils/pipeline-presets'
import { nodeFieldSchemas } from '../../../app/utils/pipeline-node-schema'
import { validateGraphQuick } from '../../../server/utils/pipeline-validator'

/**
 * P0-17. ТЗ (docs/SPEC.md, Модуль 2): «Генерирует 3 варианта сценария на выбор».
 * Во флагманском пресете стоял variantsCount: 1, то есть основной автономный контур
 * выдавал один вариант — выбирать было не из чего. Тест фиксирует контракт пресета,
 * чтобы значение не откатили «ради экономии токенов» без правки ТЗ.
 */
describe('P0-17: флагманский пресет генерирует три варианта сценария', () => {
  const preset = getPresetById('content-factory-vertical')

  function scenarioNode() {
    const node = preset!.graphData.nodes.find(n => n.data.type === 'scenario')
    expect(node, 'в пресете должна быть сценарная нода').toBeDefined()
    return node!
  }

  it('сценарная нода просит ровно три варианта', () => {
    expect(preset).toBeDefined()
    expect(scenarioNode().data.config.variantsCount).toBe(3)
  })

  it('три варианта разрешены схемой ноды и не ломают валидатор графа', () => {
    // allowedValues в схеме — то, что показывает UI и чем оперирует AI-автозаполнение.
    // Если 3 из него уберут, пресет разойдётся с редактором.
    const allowed = nodeFieldSchemas.scenario?.variantsCount?.allowedValues
    expect(allowed).toContain('3')

    const issues = validateGraphQuick(preset!.graphData.nodes, preset!.graphData.edges)
    expect(issues.filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('объём партии держит maxTrends: один тренд × три варианта', () => {
    // Тройка вариантов не должна умножаться на несколько трендов — иначе один прогон
    // партии стоит втрое дороже ожидаемого.
    const config = scenarioNode().data.config
    expect(config.maxTrends).toBe(1)

    const video = preset!.graphData.nodes.find(n => n.data.type === 'video')!
    expect(video.data.config.maxVideos).toBe(1)
  })

  it('остальная конфигурация сценарной ноды не задета', () => {
    const config = scenarioNode().data.config
    expect(config.generationMode).toBe('story_driven')
    expect(config.storytelling).toMatchObject({
      enabled: true,
      protagonistMode: 'person',
      continuityStrictness: 'moderate',
      sceneCountStrategy: 'longform',
      appIntegrationStyle: 'native',
    })
    expect(config.subtitles).toMatchObject({ enabled: true })
    expect(config.voiceover).toMatchObject({ enabled: true, pacing: 'moderate' })
  })

  it('ни один пресет не остаётся с одним вариантом сценария', () => {
    // Пресеты без явного variantsCount опираются на дефолт исполнителя (3),
    // поэтому проверяем только явно проставленные значения.
    const singles = pipelinePresets.flatMap(p =>
      p.graphData.nodes
        .filter(n => n.data.type === 'scenario' && n.data.config?.variantsCount !== undefined)
        .filter(n => Number(n.data.config.variantsCount) < 3)
        .map(n => `${p.id}/${n.id}`),
    )
    expect(singles).toEqual([])
  })
})
