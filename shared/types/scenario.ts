// ─── Scenario Node Config (pipeline) ─────────────────────

export type ScenarioGenerationMode = 'auto' | 'story_driven' | 'simple'
export type ProtagonistMode = 'person' | 'object' | 'abstract' | 'auto'
export type ContinuityStrictness = 'strict' | 'moderate' | 'relaxed'
export type SceneCountStrategy = 'auto' | 'minimal' | 'detailed' | 'cinematic'
export type AppIntegrationStyle = 'native' | 'prominent' | 'subtle'
export type SubtitleStrategyMode = 'dynamic' | 'static' | 'minimal' | 'none'
export type VoiceoverStrategy = 'full' | 'partial' | 'none'
export type AppContextMode = 'full' | 'light' | 'manual_only' | 'off'

export interface ScenarioNodeStorytellingConfig {
  enabled: boolean
  protagonistMode: ProtagonistMode
  continuityStrictness: ContinuityStrictness
  sceneCountStrategy: SceneCountStrategy
  transformationArcTemplate: string | null
  emotionalProgression: string[]
  appIntegrationStyle: AppIntegrationStyle
  environmentCues: string[]
  paletteMood: string | null
  visualConsistency: string | null
  variationIntensity: 'low' | 'medium' | 'high'
  antiLoopRules: string[]
  negativeRules: string[]
}

export interface ScenarioNodeSubtitlesConfig {
  enabled: boolean
  stylePreset: string | null
  readabilityLevel: 'easy' | 'normal' | 'dense'
  maxLineLength: number
  maxLines: number
  placementStrategy: 'auto' | 'top' | 'center' | 'bottom'
  avoidOcclusion: boolean
  styleConsistency: boolean
  sceneVariation: boolean
  autoHighlight: boolean
}

export interface ScenarioNodeAppConfig {
  appId: number | null
  contextMode: AppContextMode
  manualOverrideSummary: string | null
  appCenterStrength: 'strong' | 'soft' | 'background'
}

export interface ScenarioNodeVoiceoverConfig {
  enabled: boolean
  narratorPersona: string | null
  intensity: 'low' | 'medium' | 'high'
  pacing: 'slow' | 'moderate' | 'fast'
  syncMode: 'scene' | 'continuous' | 'highlights'
}

/** Full scenario node config stored in pipeline graph */
export interface ScenarioNodeConfig {
  // Base
  variantsCount: number
  generationMode: ScenarioGenerationMode
  profileId: number | null
  hookStyles: string[]

  // Nested sections
  storytelling: ScenarioNodeStorytellingConfig
  subtitles: ScenarioNodeSubtitlesConfig
  app: ScenarioNodeAppConfig
  voiceover: ScenarioNodeVoiceoverConfig
}

/** Default config for new scenario nodes */
export const defaultScenarioNodeConfig: ScenarioNodeConfig = {
  variantsCount: 3,
  generationMode: 'auto',
  profileId: null,
  hookStyles: [],

  storytelling: {
    enabled: true,
    protagonistMode: 'auto',
    continuityStrictness: 'moderate',
    sceneCountStrategy: 'auto',
    transformationArcTemplate: null,
    emotionalProgression: [],
    appIntegrationStyle: 'native',
    environmentCues: [],
    paletteMood: null,
    visualConsistency: null,
    variationIntensity: 'medium',
    antiLoopRules: [],
    negativeRules: [],
  },

  subtitles: {
    enabled: true,
    stylePreset: null,
    readabilityLevel: 'normal',
    maxLineLength: 40,
    maxLines: 2,
    placementStrategy: 'auto',
    avoidOcclusion: true,
    styleConsistency: true,
    sceneVariation: false,
    autoHighlight: false,
  },

  app: {
    appId: null,
    contextMode: 'full',
    manualOverrideSummary: null,
    appCenterStrength: 'soft',
  },

  voiceover: {
    enabled: false,
    narratorPersona: null,
    intensity: 'medium',
    pacing: 'moderate',
    syncMode: 'scene',
  },
}

/** Readiness status for config sections */
export type ScenarioConfigSectionStatus = 'empty' | 'partial' | 'ready'

// ─── Scenario entity types ───────────────────────────────

export type ScenarioStatus = 'draft' | 'generating' | 'generated' | 'selected' | 'rejected' | 'needs_rework' | 'archived'
export type VariantStatus = 'draft' | 'accepted' | 'rejected' | 'needs_rework' | 'superseded'
export type ReviewActionType = 'accept' | 'reject' | 'rework' | 'regenerate' | 'delete_scenario' | 'delete_variant' | 'copy' | 'regenerate_block'

export interface VisualStyleStructured {
  colors: string[]
  atmosphere: string
  character: string
  stylePrompt: string
  improvedPrompt?: string
  lighting?: string
  cameraWork?: string
  effects?: string[]
}

export interface ScenarioVariant {
  id: number
  scenarioId: number
  variantIndex: number
  status: VariantStatus
  title: string
  hook: string
  body: string
  cta: string
  fullScript: string
  visualStyleText: string
  visualStyleStructured: VisualStyleStructured | null
  storyPlan: import('~~/shared/types/story').StoryPlan | null
  toneProfile: string | null
  rationale: string | null
  promptVersion: string | null
  agentVersion: string | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ScenarioReviewAction {
  id: number
  scenarioId: number
  variantId: number | null
  actionType: ReviewActionType
  reason: string | null
  createdAt: string
}

export interface Scenario {
  id: number
  trendId: number
  briefId: number | null
  appId: number | null
  profileId: number | null
  status: ScenarioStatus
  selectedVariantId: number | null
  generationStatus: string | null
  operatorNotes: string | null
  reworkRequest: string | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
  variants?: ScenarioVariant[]
  reviewActions?: ScenarioReviewAction[]
  trend?: {
    id: number
    title: string
    platform: string
  } | null
}

export interface ScenarioListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

// ─── Scenario Quality Critic ─────────────────────────────

export type CriticVerdict = 'pass' | 'pass_with_notes' | 'rework' | 'reject'

/**
 * Множественные оценки одного варианта по 6 критериям.
 * Все scores — целые числа от 1 до 10.
 * totalScore — 0..100 (среднее × 10, округлено до целого).
 */
export interface VariantQualityScore {
  variantIndex: number
  variantId: number
  scores: {
    hookStrength: number
    emotionalArc: number
    appIntegration: number
    visualClarity: number
    ctaPower: number
    viralPotential: number
  }
  totalScore: number
  strengths: string[]
  weaknesses: string[]
  reworkSuggestions: string[]
  verdict: CriticVerdict
}

/**
 * Полный output AI-критика по N вариантам сценария.
 */
export interface CriticOutput {
  scores: VariantQualityScore[]
  bestVariantIndex: number
  bestVariantId: number
  averageScore: number
  needsRework: boolean
  reasoning: string
}

/**
 * Запись из CriticReview (для UI history).
 */
export interface CriticReviewRecord {
  id: number
  scenarioId: number
  iteration: number
  variantsReviewed: number
  bestVariantId: number | null
  averageScore: number
  needsRework: boolean
  reachedThreshold: boolean
  fullReport: CriticOutput
  modelVersion: string
  promptVersion: string
  durationMs: number
  costEstimate: number | null
  createdAt: string
}
