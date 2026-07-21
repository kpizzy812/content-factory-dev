/**
 * Story Video Planner.
 * Преобразует StoryPlan в исполнимый StoryDrivenVideoPlan.
 * Обеспечивает: duration parsing, scene reconciliation, cost-aware decisions.
 */

import type { StoryPlan, VoiceoverLine } from '~~/shared/types/story'
import type { ModelMeta } from './video-models'
import {
  parseSceneDuration,
  clampDurationToModel,
  buildVoiceoverAudioPlan,
  detectRuntimeMode,
} from '~~/shared/types/video-runtime'
import type {
  StoryDrivenVideoPlan,
  SceneRuntimeUnit,
  VideoRuntimeMode,
} from '~~/shared/types/video-runtime'

interface PlannerInput {
  storyPlan: StoryPlan | null | undefined
  /** Video model metadata (for duration constraints) */
  videoModel: ModelMeta
  /** User-specified image count (from Video record) */
  userImageCount: number
  /** User-specified clip duration fallback */
  userClipDuration: number
  /** Whether user explicitly wants image generation */
  forceImageGeneration?: boolean
  /** Account style context formatted for prompts */
  accountStyleContext?: string | null
  /** App context formatted for prompts */
  appContext?: string | null
}

/**
 * Build executable video plan from StoryPlan + user config.
 * Handles: duration parsing, model clamping, scene count reconciliation, cost decisions.
 */
export function buildStoryVideoPlan(input: PlannerInput): StoryDrivenVideoPlan {
  const { storyPlan, videoModel, userImageCount, userClipDuration } = input
  const mode = detectRuntimeMode(storyPlan)
  const warnings: string[] = []

  // Legacy / no story plan — return minimal plan
  if (mode === 'legacy_simple' || !storyPlan) {
    return buildLegacyPlan(input, warnings)
  }

  // ── Parse scene durations ──
  const voLinesByScene = new Map<number, VoiceoverLine>()
  if (storyPlan.voiceoverPlan?.lines) {
    for (const line of storyPlan.voiceoverPlan.lines) {
      voLinesByScene.set(line.sceneOrder, line)
    }
  }

  const scenes: SceneRuntimeUnit[] = storyPlan.scenes.map((scene) => {
    const rawDuration = parseSceneDuration(scene.duration)
    const { duration, clamped } = clampDurationToModel(
      rawDuration,
      videoModel.durationRange,
      videoModel.durationOptions,
    )
    if (clamped) {
      warnings.push(
        `Сцена ${scene.order}: длительность ${scene.duration} скорректирована до ${duration}s `
        + `(ограничения модели ${videoModel.name}: ${videoModel.durationRange?.join('-') || videoModel.durationOptions?.join('/')}s)`,
      )
    }

    const voLine = voLinesByScene.get(scene.order)

    return {
      order: scene.order,
      durationSec: duration,
      durationRaw: scene.duration,
      durationClamped: clamped,
      visualPrompt: scene.visualPromptGuidance,
      purpose: scene.purpose,
      subtitleCopy: scene.subtitleCopy || '',
      subtitlePlacement: scene.subtitlePlacement,
      voiceoverLine: voLine?.text ?? scene.voiceoverLine ?? null,
      voiceoverEmotion: voLine?.emotion ?? null,
      voiceoverPauseAfter: voLine?.pauseAfter ?? 'none',
      spokenLine: scene.spokenLine ?? null,
      appIntegrationBeat: scene.appIntegrationBeat,
      continuityNotes: scene.continuityNotes,
      cameraAngle: scene.cameraAngle,
      props: scene.props,
      emotionalState: scene.emotionalState,
      setting: scene.setting,
      action: scene.action,
      devicesInScene: scene.devicesInScene && scene.devicesInScene.length > 0
        ? [...scene.devicesInScene]
        : undefined,
    }
  })

  // ── Scene count reconciliation ──
  // Story-driven: все сцены должны быть исполнены, imageCount не должен их усекать
  if (scenes.length > userImageCount) {
    warnings.push(
      `StoryPlan содержит ${scenes.length} сцен, но imageCount=${userImageCount}. `
      + `Все ${scenes.length} сцен будут использованы (imageCount автоматически расширен для story-driven mode).`,
    )
  }

  const totalDuration = scenes.reduce((sum, s) => sum + s.durationSec, 0)

  // ── Cost-aware image generation decision ──
  // Story-driven clip-based flow: images are intermediate artifacts not used in final video.
  // Skip image generation by default to save costs, unless explicitly forced.
  const skipImageGeneration = !input.forceImageGeneration

  // ── Build voiceover audio plan ──
  const voiceoverPlan = storyPlan.voiceoverPlan?.enabled
    ? storyPlan.voiceoverPlan
    : null

  const voiceoverAudioPlan = buildVoiceoverAudioPlan(
    voiceoverPlan,
    scenes.map(s => ({ order: s.order, durationSec: s.durationSec })),
  )

  if (voiceoverAudioPlan.status === 'planned') {
    warnings.push(
      `Voiceover запланирован (${voiceoverAudioPlan.scenes.length} фраз, ~${voiceoverAudioPlan.totalEstimatedDurationSec}s). `
      + `Реальная озвучка синтезируется на шаге voiceover_generation, если Video.voiceoverEnabled=true.`,
    )
  }

  return {
    mode,
    scenes,
    totalDurationSec: totalDuration,
    skipImageGeneration,
    globalVisualContext: {
      stylePrompt: storyPlan.globalVisualSystem.stylePrompt,
      colorPalette: storyPlan.globalVisualSystem.colorPalette,
      mood: storyPlan.globalVisualSystem.mood,
      lighting: storyPlan.globalVisualSystem.lighting,
    },
    protagonistContext: {
      type: storyPlan.protagonist.type,
      description: storyPlan.protagonist.description,
      visualIdentifiers: storyPlan.protagonist.visualIdentifiers,
      initialState: storyPlan.protagonist.initialState,
      finalState: storyPlan.protagonist.finalState,
    },
    continuityRules: {
      antiLoopRules: storyPlan.continuityBible?.antiLoopRules ?? [],
      forbiddenElements: storyPlan.continuityBible?.forbiddenElements ?? [],
      sceneTransitions: storyPlan.continuityBible?.sceneTransitions ?? [],
    },
    negativeConstraints: storyPlan.negativeConstraints ?? [],
    appIntegrationStrategy: storyPlan.appIntegrationStrategy ?? null,
    subtitleStyle: storyPlan.subtitleStyle ?? null,
    voiceoverPlan,
    accountStyleContext: input.accountStyleContext ?? null,
    appContext: input.appContext ?? null,
    warnings,
  }
}

/**
 * Build minimal plan for legacy (non-story-driven) videos.
 */
function buildLegacyPlan(input: PlannerInput, warnings: string[]): StoryDrivenVideoPlan {
  const { userClipDuration, videoModel } = input
  const { duration, clamped } = clampDurationToModel(
    userClipDuration,
    videoModel.durationRange,
    videoModel.durationOptions,
  )
  if (clamped) {
    warnings.push(`clipDuration ${userClipDuration}s скорректирован до ${duration}s (ограничения модели)`)
  }

  return {
    mode: 'legacy_simple',
    scenes: [],
    totalDurationSec: duration * (input.userImageCount || 3),
    skipImageGeneration: false,
    globalVisualContext: { stylePrompt: '', colorPalette: [], mood: '', lighting: '' },
    protagonistContext: {
      type: 'abstract',
      description: '',
      visualIdentifiers: [],
      initialState: '',
      finalState: '',
    },
    continuityRules: { antiLoopRules: [], forbiddenElements: [], sceneTransitions: [] },
    negativeConstraints: [],
    appIntegrationStrategy: null,
    subtitleStyle: null,
    voiceoverPlan: null,
    accountStyleContext: input.accountStyleContext ?? null,
    appContext: input.appContext ?? null,
    warnings,
  }
}
