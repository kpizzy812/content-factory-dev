import { describe, expect, it } from 'vitest'
import { getPresetById } from '../../shared/utils/pipeline-presets'
import { inspectFactoryPipeline } from '../../server/utils/content-factory-batch'
import { validateGraphQuick } from '../../server/utils/pipeline-validator'

describe('content factory vertical preset', () => {
  const preset = getPresetById('content-factory-vertical')

  it('contains the complete autonomous production path', () => {
    expect(preset).toBeDefined()
    const nodes = preset!.graphData.nodes
    const types = nodes.map(node => node.data.type)

    expect(types).toEqual([
      'content_strategy',
      'character',
      'scenario',
      'quality_gate',
      'video',
      'quality_gate',
      'caption_generator',
      'upload',
    ])
    expect(preset!.graphData.edges).toContainEqual(expect.objectContaining({
      source: 'strategy-1',
      target: 'character-1',
    }))

    expect(inspectFactoryPipeline(preset!.graphData)).toEqual({
      hasContentStrategy: true,
      hasScriptQualityGate: true,
      hasFinalQualityGate: true,
      requiresFunnel: true,
      requiresApprovedLeadMagnet: true,
    })
  })

  it('uses 70-90 second story mode and required avatar lip-sync', () => {
    const nodes = preset!.graphData.nodes
    const scenario = nodes.find(node => node.data.type === 'scenario')!
    const character = nodes.find(node => node.data.type === 'character')!
    const video = nodes.find(node => node.data.type === 'video')!

    expect(scenario.data.config.storytelling).toMatchObject({
      enabled: true,
      sceneCountStrategy: 'longform',
    })
    expect(character.data.config).toMatchObject({
      role: 'protagonist',
      requireSourceClips: true,
    })
    expect(video.data.config).toMatchObject({
      format: 'vertical',
      lipSyncEnabled: true,
      lipSyncModelId: 'kwaivgi/kling-lip-sync',
      requireLipSyncCharacter: true,
    })
  })

  it('has no blocking graph validation errors', () => {
    const issues = validateGraphQuick(preset!.graphData.nodes, preset!.graphData.edges)
    expect(issues.filter(issue => issue.severity === 'error')).toEqual([])
  })
})
