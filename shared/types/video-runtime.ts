/**
 * Video Runtime Types.
 * Контракты между story-driven scenario pipeline и video generation pipeline.
 * Определяют как StoryPlan превращается в исполнимый видео-план.
 */

import type { StoryPlan, SceneCard, SubtitleStyleProfile, SubtitlePlacement, VoiceoverPlan, VoiceoverLine } from './story'
import type { DeviceType } from '~~/shared/utils/video-prompt-helpers'

// ─── Runtime Mode ─────────────────────────────────────

/** Режим исполнения video pipeline */
export type VideoRuntimeMode = 'story_driven' | 'legacy_simple' | 'hybrid'

/**
 * Определяет runtime mode на основе наличия и полноты StoryPlan.
 */
export function detectRuntimeMode(storyPlan: StoryPlan | null | undefined): VideoRuntimeMode {
  if (!storyPlan?.scenes?.length) return 'legacy_simple'
  // Story-driven если есть минимум 2 сцены с duration и visualPromptGuidance
  const validScenes = storyPlan.scenes.filter(
    s => s.visualPromptGuidance && s.duration,
  )
  if (validScenes.length >= 2) return 'story_driven'
  // Hybrid: есть scenes но неполные
  if (storyPlan.scenes.length > 0) return 'hybrid'
  return 'legacy_simple'
}

// ─── Scene Runtime Unit ───────────────────────────────

/** Parsed scene ready for video pipeline execution */
export interface SceneRuntimeUnit {
  /** Scene order (from StoryPlan) */
  order: number
  /** Parsed duration in seconds */
  durationSec: number
  /** Original duration string from StoryPlan */
  durationRaw: string
  /** Was duration clamped to model limits? */
  durationClamped: boolean
  /** Visual prompt for image/clip generation */
  visualPrompt: string
  /** Scene purpose (for logging/debugging) */
  purpose: string
  /** Subtitle text for this scene */
  subtitleCopy: string
  /** Subtitle placement */
  subtitlePlacement: SubtitlePlacement
  /** Voiceover line (null if voiceover disabled) */
  voiceoverLine: string | null
  /** Voiceover emotion */
  voiceoverEmotion: string | null
  /** Voiceover pause after */
  voiceoverPauseAfter: 'none' | 'short' | 'long'
  /** Прямая речь персонажа в кадре — идёт в kling prompt для lip-sync (generate_audio) */
  spokenLine: string | null
  /** App integration beat — how app appears in this scene */
  appIntegrationBeat: string | null
  /** Continuity notes for scene transitions */
  continuityNotes: string
  /** Camera angle */
  cameraAngle: string
  /** Props */
  props: string[]
  /** Emotional state */
  emotionalState: string
  /** Setting */
  setting: string
  /** Action */
  action: string
  /** Devices в кадре — триггерит DEVICE ORIENTATION RULES + DEVICE_NEGATIVES downstream */
  devicesInScene?: DeviceType[]
}

// ─── Story-Driven Video Plan ──────────────────────────

/** Full executable plan derived from StoryPlan */
export interface StoryDrivenVideoPlan {
  /** Runtime mode */
  mode: VideoRuntimeMode
  /** Scene units ready for execution */
  scenes: SceneRuntimeUnit[]
  /** Total planned duration in seconds */
  totalDurationSec: number
  /** Whether image generation stage should be skipped (clips-only mode) */
  skipImageGeneration: boolean
  /** Global visual context for prompt enrichment */
  globalVisualContext: {
    stylePrompt: string
    colorPalette: string[]
    mood: string
    lighting: string
  }
  /** Protagonist continuity context */
  protagonistContext: {
    type: string
    description: string
    visualIdentifiers: string[]
    initialState: string
    finalState: string
  }
  /** Continuity rules */
  continuityRules: {
    antiLoopRules: string[]
    forbiddenElements: string[]
    sceneTransitions: string[]
  }
  /** Negative constraints from story plan */
  negativeConstraints: string[]
  /** App integration strategy narrative */
  appIntegrationStrategy: string | null
  /** Subtitle style profile */
  subtitleStyle: SubtitleStyleProfile | null
  /** Voiceover plan */
  voiceoverPlan: VoiceoverPlan | null
  /** Account style context (formatted for prompts) */
  accountStyleContext: string | null
  /** App context (formatted for prompts) */
  appContext: string | null
  /** Warnings generated during planning */
  warnings: string[]
}

// ─── Voiceover Contract ───────────────────────────────

/** Status of voiceover in the current pipeline run */
export type VoiceoverStatus = 'disabled' | 'planned' | 'audio_ready' | 'no_provider'

/** Voiceover audio plan for a single scene */
export interface SceneVoiceoverAudio {
  sceneOrder: number
  text: string
  emotion: string
  /** Audio file path (null until TTS generates it) */
  audioPath: string | null
  /** Estimated duration in seconds based on text length and pacing */
  estimatedDurationSec: number
  /** Pause after in seconds */
  pauseAfterSec: number
}

/** Full voiceover audio plan */
export interface VoiceoverAudioPlan {
  status: VoiceoverStatus
  narratorPersona: string | null
  pacing: 'slow' | 'moderate' | 'fast'
  scenes: SceneVoiceoverAudio[]
  /** Total estimated voiceover duration */
  totalEstimatedDurationSec: number
  /** Provider used (null if no provider available) */
  provider: string | null
}

/**
 * Build voiceover audio plan from VoiceoverPlan.
 * Does NOT synthesize audio — just creates the execution plan.
 */
export function buildVoiceoverAudioPlan(
  voiceoverPlan: VoiceoverPlan | null | undefined,
  sceneDurations: Array<{ order: number; durationSec: number }>,
): VoiceoverAudioPlan {
  if (!voiceoverPlan?.enabled || !voiceoverPlan.lines?.length) {
    return {
      status: 'disabled',
      narratorPersona: null,
      pacing: 'moderate',
      scenes: [],
      totalEstimatedDurationSec: 0,
      provider: null,
    }
  }

  const pauseMap: Record<string, number> = { none: 0, short: 0.5, long: 1.5 }

  const scenes: SceneVoiceoverAudio[] = voiceoverPlan.lines.map((line: VoiceoverLine) => {
    const estimatedDuration = Math.max(1, estimateSpeechDurationSec(line.text, voiceoverPlan.pacing))
    const pauseAfterSec = pauseMap[line.pauseAfter] ?? 0

    return {
      sceneOrder: line.sceneOrder,
      text: line.text,
      emotion: line.emotion,
      audioPath: null,
      estimatedDurationSec: Math.round(estimatedDuration * 10) / 10,
      pauseAfterSec,
    }
  })

  const totalDuration = scenes.reduce(
    (sum, s) => sum + s.estimatedDurationSec + s.pauseAfterSec,
    0,
  )

  return {
    status: 'planned',
    narratorPersona: voiceoverPlan.narratorPersona,
    pacing: voiceoverPlan.pacing,
    scenes,
    totalEstimatedDurationSec: Math.round(totalDuration * 10) / 10,
    provider: null, // No TTS provider yet
  }
}

// ─── Duration Helpers ─────────────────────────────────

/** Темп речи в словах в секунду. Единственный источник для всех оценок длины реплики. */
export const SPEECH_WORDS_PER_SECOND: Record<string, number> = {
  slow: 2.0,
  moderate: 2.8,
  fast: 3.5,
}

/**
 * Запас, который сцена обязана иметь сверх речи.
 *
 * Реконсиляция озвучки оставляет 0.1 с зазора и при нехватке места УСКОРЯЕТ или
 * РЕЖЕТ реплику — это и есть оборванная фраза, на которую жалуется заказчик.
 * Оценка по словам всегда приблизительна (Fish на русском читает медленнее
 * табличных 2.8 слова в секунду), поэтому округляем в сторону сцены подлиннее:
 * лишняя секунда кадра стоит $0.045, обрезанная фраза — переснятого ролика.
 */
export const SPEECH_HEADROOM_SEC = 1

/**
 * Сколько секунд примерно звучит реплика. Пустой текст — ноль секунд:
 * «минимум одна секунда» здесь означал бы сцену под несуществующую речь.
 */
export function estimateSpeechDurationSec(
  text: string | null | undefined,
  pacing: string | null | undefined,
): number {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return 0
  const wps = SPEECH_WORDS_PER_SECOND[pacing ?? 'moderate'] ?? SPEECH_WORDS_PER_SECOND.moderate!
  return trimmed.split(/\s+/).length / wps
}

/** Ограничения модели на длину клипа — либо фиксированный набор, либо диапазон. */
export interface ModelDurationConstraints {
  durationRange?: [number, number] | readonly [number, number]
  durationOptions?: number[] | readonly number[]
}

/**
 * Наименьшая длительность сцены, в которую речь укладывается с запасом.
 *
 * Отличие от `clampDurationToModel` принципиальное: тот берёт БЛИЖАЙШИЙ вариант и
 * потому умеет округлить вниз — речь на 5.9 с получила бы пятисекундную сцену и
 * была бы обрезана. Здесь округление всегда вверх, а если речь не влезает даже в
 * максимум модели — берётся максимум: удлинить сцену нечем, но и молча резать
 * реплику под меньший вариант незачем.
 */
export function pickSceneDurationForSpeech(
  speechDurationSec: number,
  constraints: ModelDurationConstraints,
): number {
  const needed = Math.max(0, speechDurationSec) + SPEECH_HEADROOM_SEC

  const options = constraints.durationOptions
  if (options?.length) {
    const sorted = [...options].sort((a, b) => a - b)
    return sorted.find(option => option >= needed) ?? sorted[sorted.length - 1]!
  }

  if (constraints.durationRange) {
    const [min, max] = constraints.durationRange
    return Math.min(max, Math.max(min, needed))
  }

  return needed
}

/**
 * Parse scene duration string ("3s", "5s", "10") into seconds.
 */
export function parseSceneDuration(raw: string): number {
  if (!raw) return 5
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*s?$/)
  if (!match) return 5
  return Math.max(1, Math.min(30, Number(match[1])))
}

/**
 * Clamp duration to model's supported range.
 * Returns clamped value and whether clamping occurred.
 */
export function clampDurationToModel(
  durationSec: number,
  modelRange: [number, number] | undefined,
  modelOptions: number[] | undefined,
): { duration: number; clamped: boolean } {
  if (modelOptions?.length) {
    // Find closest supported option
    const closest = modelOptions.reduce((prev, curr) =>
      Math.abs(curr - durationSec) < Math.abs(prev - durationSec) ? curr : prev,
    )
    return { duration: closest, clamped: closest !== durationSec }
  }

  if (modelRange) {
    const [min, max] = modelRange
    const clamped = Math.max(min, Math.min(max, durationSec))
    return { duration: clamped, clamped: clamped !== durationSec }
  }

  // No constraints known — pass through
  return { duration: durationSec, clamped: false }
}
