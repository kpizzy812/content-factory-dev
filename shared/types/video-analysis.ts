/**
 * Marketing-grade frame analysis типы (Этап 2 портирования из MarketingCamp).
 *
 * Используется новым `analyzeCreativeVideo` orchestrator + `analyzeFramesMarketing`
 * AI-агентом. JSON-снимок результата хранится в `Video.analysisData` как
 * `VideoAnalysisFramePass`. Per-frame description/keyElements параллельно
 * раскладываются по DB-модели `VideoFrame`.
 *
 * Storyboard-режим (Idea/reference flow) использует свои типы из
 * server/utils/agents/video-frame-analyzer-agent — НЕ дублируем здесь.
 */

export type FrameStructureEvaluation = 'strong' | 'weak' | 'absent'

export type FrameTagCategory
  = | 'theme'
    | 'emotion'
    | 'format'
    | 'audience'
    | 'platform'
    | 'style'
    | 'hook'
    | 'cta'
    | 'persona'

export interface FrameStructureHook {
  frameSeq: number
  description: string
  evaluation: FrameStructureEvaluation
}

export interface FrameStructureBody {
  frameSeq: number
  description: string
}

export interface FrameStructureCta {
  frameSeq: number | null
  description: string
  present: boolean
}

export interface MarketingFrameDescription {
  sequence: number
  description: string
  onScreenText: string | null
  /**
   * keyElements может прийти как массив строк (текущая семантика MC) или как
   * map ключ → значение (если AI развернёт сложнее). Обе формы валидны.
   */
  keyElements: string[] | Record<string, unknown>
}

export interface MarketingFrameTag {
  category: FrameTagCategory
  /** Snake-case английский слаг (e.g. `quick_relief`, `gen_z_humor`). */
  name: string
}

export interface MarketingFrameAnalysis {
  summary: string
  structure: {
    hook: FrameStructureHook
    /** 2..5 элементов; меньше — сигнал что AI не понял задачу. */
    body: FrameStructureBody[]
    cta: FrameStructureCta
  }
  /** Длина должна совпадать с количеством переданных кадров. */
  frameDescriptions: MarketingFrameDescription[]
  viralityFactors: string[]
  weaknesses: string[]
  tags: MarketingFrameTag[]
  /** Целевая аудитория одной фразой; null если AI не уверен. */
  audience: string | null
  /** 0..1 — насколько креатив подходит для App. */
  fitScore: number
  /** Краткое объяснение fitScore (1-2 предложения). */
  fitRationale: string
  /** 0..1 — уверенность модели в собственном разборе. */
  confidence: number
}

/**
 * Storyboard-режим для Idea/reference flow живёт в `server/utils/agents/video-frame-analyzer-agent`.
 * Алиас экспортируется чтобы Этап 3 мог типизировать оба режима из одного места.
 */
export type StoryboardFrameAnalysis = import('../../server/utils/agents/video-frame-analyzer-agent').FrameAnalysisResult

/**
 * Wrapper для хранения в `Video.analysisData`.
 * `modeVersion` — пин промпта/схемы. Меняется при breaking change для invalidation TTL.
 * `mode` — режим анализа (сейчас только 'marketing', storyboard живёт в IdeaAnalysis.referenceBreakdown).
 */
export interface VideoAnalysisFramePass {
  modeVersion: string // 'frames-v1'
  mode: 'marketing'
  runAt: string // ISO date
  durationSec: number
  framesExtracted: number
  framesSentToAi: number
  framesSkipped: number[]
  result: MarketingFrameAnalysis
}
