/**
 * Unit-тесты для scene-driven-scenario pure-helpers.
 *
 * Не трогает БД — проверяем чистую логику buildSceneDrivenStoryPlan + структуру
 * StoryPlan, которая требуется detectRuntimeMode → story_driven (≥2 scenes
 * с visualPromptGuidance + duration).
 *
 * runScenarioGenerationForScene (БД-зависимая) покрывается integration spec'ом.
 */
import { describe, it, expect } from 'vitest'
import { buildSceneDrivenStoryPlan } from '../../server/utils/scene-driven-scenario'
import type { SceneScripterOutput } from '../../server/utils/agents/scene-scripter'

function makeScripterOutput(opts: { scenesCount?: number } = {}): SceneScripterOutput {
  const count = opts.scenesCount ?? 2
  const scenes = Array.from({ length: count }, (_, i) => ({
    order: i + 1,
    purpose: `purpose ${i + 1}`,
    setting: `setting ${i + 1}`,
    action: `action ${i + 1}`,
    whatChanges: 'change',
    emotionalState: 'curious',
    appIntegrationBeat: i === 0 ? null : 'integration',
    visualPromptGuidance: `visual prompt scene ${i + 1}, cinematic`,
    appScreenRef: null,
    subtitleCopy: `subtitle ${i + 1}`,
    subtitlePlacement: { position: 'bottom' as const, alignment: 'center' as const, avoidZones: [] },
    voiceoverLine: null,
    spokenLine: null,
    continuityNotes: 'notes',
    duration: '5s',
    cameraAngle: 'medium shot',
    props: [],
    appliedReferences: [],
  }))
  return {
    title: 'T',
    hook: 'h',
    body: 'b',
    cta: 'c',
    fullScript: 'fs',
    visualStyleText: 'vs',
    visualStyleStructured: null,
    toneProfile: 'tone',
    storyArc: {
      template: 'discovery',
      premise: 'p',
      conflict: 'c',
      turningPoint: 't',
      resolution: 'r',
      emotionalJourney: [],
    },
    protagonist: {
      type: 'person',
      description: 'desc',
      initialState: 'baseline',
      finalState: 'transformed',
      visualIdentifiers: [],
    },
    scenes,
    appIntegrationStrategy: 'strategy',
    continuityBible: {
      protagonist: {
        type: 'person',
        description: 'desc',
        initialState: 'baseline',
        finalState: 'transformed',
        visualIdentifiers: [],
      },
      visualCode: {
        colorPalette: ['#F5E6D3', '#D4A574'],
        lightingConsistency: 'natural',
        environmentStyle: 'minimalist',
      },
      antiLoopRules: [],
      sceneTransitions: [],
      forbiddenElements: [],
    },
  }
}

describe('buildSceneDrivenStoryPlan', () => {
  it('возвращает version "scene-driven-1.0"', () => {
    const plan = buildSceneDrivenStoryPlan({
      sceneId: 'scene-1',
      compiledPrompt: 'compiled prompt',
      referenceImageUrls: [],
      referenceImages: [],
      scripter: makeScripterOutput(),
      primaryAppReference: null,
    })
    expect(plan.version).toBe('scene-driven-1.0')
  })

  it('содержит ≥2 scenes с visualPromptGuidance + duration (для detectRuntimeMode → story_driven)', () => {
    const plan = buildSceneDrivenStoryPlan({
      sceneId: 'scene-2',
      compiledPrompt: 'prompt',
      referenceImageUrls: [],
      referenceImages: [],
      scripter: makeScripterOutput({ scenesCount: 2 }),
      primaryAppReference: null,
    })
    expect(plan.scenes.length).toBeGreaterThanOrEqual(2)
    for (const s of plan.scenes) {
      expect(typeof s.visualPromptGuidance).toBe('string')
      expect(s.visualPromptGuidance.trim().length).toBeGreaterThan(0)
      expect(typeof s.duration).toBe('string')
      expect(s.duration.length).toBeGreaterThan(0)
    }
  })

  it('переносит sceneId + compiledPrompt + referenceImages в storyPlan extension', () => {
    const plan = buildSceneDrivenStoryPlan({
      sceneId: 'scene-XYZ',
      compiledPrompt: 'compiled XYZ',
      negativePrompt: 'no blur',
      referenceImageUrls: ['https://example.com/r1.jpg'],
      referenceImages: [
        { source: 'character', sourceId: 'c1', url: 'https://example.com/r1.jpg', kind: 'face' },
      ],
      scripter: makeScripterOutput(),
      primaryAppReference: null,
    })
    expect(plan.sceneId).toBe('scene-XYZ')
    expect(plan.compiledPrompt).toBe('compiled XYZ')
    expect(plan.negativePrompt).toBe('no blur')
    expect(plan.referenceImageUrls).toEqual(['https://example.com/r1.jpg'])
    expect(plan.referenceImages.length).toBe(1)
    expect(plan.negativeConstraints).toEqual(['no blur'])
  })

  it('appScreenRef заполнен в scenes[0] если есть primaryAppReference', () => {
    const plan = buildSceneDrivenStoryPlan({
      sceneId: 'scene-3',
      compiledPrompt: 'p',
      referenceImageUrls: [],
      referenceImages: [],
      scripter: makeScripterOutput({ scenesCount: 2 }),
      primaryAppReference: {
        id: 'ari-1',
        appId: 1,
        fileUrl: 'https://example.com/screen.jpg',
        sha1: 'abc',
        storageKey: null,
        storageProvider: 'gcs',
        mimeType: 'image/jpeg',
        bytes: null,
        width: null,
        height: null,
        order: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createdAt: new Date() as any,
        aiTags: [],
        aiCaption: null,
        aiVisualDescription: null,
        aiAnalyzedAt: null,
        aiError: null,
        aiAttempts: 0,
        generationPrompt: null,
        generationModel: null,
        generationCostUsd: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    expect(plan.scenes[0]!.appScreenRef).not.toBeNull()
    expect(plan.scenes[0]!.appScreenRef!.imageId).toBe('ari-1')
    expect(plan.scenes[1]!.appScreenRef).toBeNull()
  })

  it('appScreenRef null во всех scenes если primaryAppReference=null', () => {
    const plan = buildSceneDrivenStoryPlan({
      sceneId: 'scene-4',
      compiledPrompt: 'p',
      referenceImageUrls: [],
      referenceImages: [],
      scripter: makeScripterOutput({ scenesCount: 3 }),
      primaryAppReference: null,
    })
    for (const s of plan.scenes) {
      expect(s.appScreenRef).toBeNull()
    }
  })

  it('voiceoverPlan.enabled=true при наличии voiceoverLine или fallback из fullScript', () => {
    const plan = buildSceneDrivenStoryPlan({
      sceneId: 'scene-5',
      compiledPrompt: 'p',
      referenceImageUrls: [],
      referenceImages: [],
      scripter: makeScripterOutput(),
      primaryAppReference: null,
    })
    expect(plan.voiceoverPlan.enabled).toBe(true)
    expect(plan.voiceoverPlan.lines.length).toBeGreaterThan(0)
  })

  it('subtitleStyle присутствует с дефолтным шрифтом', () => {
    const plan = buildSceneDrivenStoryPlan({
      sceneId: 'scene-6',
      compiledPrompt: 'p',
      referenceImageUrls: [],
      referenceImages: [],
      scripter: makeScripterOutput(),
      primaryAppReference: null,
    })
    expect(plan.subtitleStyle.typography.fontIntent).toBe('bold sans-serif')
    expect(plan.subtitleStyle.visual.primaryColor).toBe('#FFFFFF')
  })
})
