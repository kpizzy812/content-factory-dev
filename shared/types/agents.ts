// --- Keyword Agent ---

export interface KeywordAgentInput {
  appName: string
  appDescription?: string
  niche?: string
  geo?: string
  language?: string
  platforms?: string[]
}

export interface KeywordAgentResult {
  semanticTags: string[]
  viralTags: string[]
  nicheTags: string[]
  searchKeywords: string[]
  confidence: number
  reasoning: string
}

// --- Hook Agent ---

export type HookType = 'question' | 'shock' | 'story' | 'controversy' | 'pain_point' | 'promise'

export interface HookItem {
  text: string
  type: HookType
  visualCue: string
  retentionScore: number
}

export interface HookAgentInput {
  scenario: {
    title: string
    hook: string
    body: string
    cta: string
    visualStyle?: string
  }
  platform?: string
  count?: number
}

export interface HookAgentResult {
  hooks: HookItem[]
}

// --- Visual Style Agent ---

export interface SceneDescription {
  sceneNumber: number
  description: string
  duration: string
  cameraAngle: string
}

export interface VisualStyleInput {
  scenario: { title: string; hook: string; body: string; cta: string }
  appName: string
  niche?: string
}

export interface VisualStyleResult {
  colorPalette: string[]
  lighting: string
  mood: string
  characterDescription: string
  imagePromptSuffix: string
  sceneDescriptions: SceneDescription[]
}

// --- Copywriting Agent ---

export interface PlatformCopy {
  title: string
  description: string
  hashtags: string[]
  cta: string
}

export interface CopywritingInput {
  scenario: { title: string; hook: string; body: string; cta: string }
  platforms: string[]
  appName: string
}

export interface CopywritingResult {
  platformVariants: Record<string, PlatformCopy>
}

// --- Posting Time Agent ---

export interface BestTimeSlot {
  day: string
  hour: string
  reason: string
}

export interface PostingTimeInput {
  platform: string
  geo: string
  niche?: string
  timezone?: string
}

export interface PostingTimeResult {
  bestTimes: BestTimeSlot[]
  avoidTimes: string[]
  timezone: string
}

// --- Platform Adaptation Agent ---

export interface PlatformAdaptation {
  script: string
  editingNotes: string
  textOverlays: string[]
  duration: string
}

export interface PlatformAdaptationInput {
  scenario: {
    title: string
    hook: string
    body: string
    cta: string
    visualStyle?: string
  }
  platforms: string[]
}

export interface PlatformAdaptationResult {
  adaptations: Record<string, PlatformAdaptation>
}

// --- Trend Analyzer Agent ---

export interface TrendAnalysisInput {
  platform: string
  title: string
  description?: string | null
  authorName?: string | null
  hashtags?: string[] | null
  viewCount?: number | null
  likeCount?: number | null
  commentCount?: number | null
  shareCount?: number | null
  publishedAt?: string | null
  language?: string | null
  geo?: string | null
  thumbnailUrl?: string | null
  sourceUrl?: string | null
}

export interface TrendHookAnalysis {
  type: string
  description: string
  strength: number
  textOnScreen?: string
  emotionalTrigger: string
}

export interface TrendSceneItem {
  order: number
  name: string
  description: string
  estimatedDuration: string
  purpose: string
}

export interface TrendSceneStructure {
  estimatedDuration: string
  scenes: TrendSceneItem[]
  narrativeArc: string
  pacingNotes: string
}

export interface TrendVisualStyle {
  colorTone: string
  lighting: string
  cameraWork: string
  textOverlays: boolean
  effects: string[]
  aesthetic: string
}

export interface TrendViralityFactor {
  factor: string
  description: string
  impact: 'high' | 'medium' | 'low'
}

export interface TrendViralityReasons {
  primaryReason: string
  factors: TrendViralityFactor[]
  targetAudience: string
  replicability: number
  replicabilityNotes: string
}

export interface TrendAnalysisResult {
  hookAnalysis: TrendHookAnalysis
  sceneStructure: TrendSceneStructure
  visualStyle: TrendVisualStyle
  viralityReasons: TrendViralityReasons
  summary: string
  confidence?: number
}
