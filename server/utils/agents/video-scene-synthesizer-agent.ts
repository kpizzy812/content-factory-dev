/**
 * Video Scene Synthesizer Agent — синтезирует ReferenceBreakdown из пофреймового анализа + транскрипта.
 *
 * Stage A (Pattern Extraction): сцены / нарратив / визуал / субтитры / app-интеграция.
 *   На вход: frameAnalyses[] + transcript + metadata. Источник истины — кадры, не догадки.
 * Stage B (Originality Transform): абстрагированные паттерны + originality guide.
 *   Переиспользует существующий `buildOriginalityPrompt` из reference-analyzer-agent.
 */

import type {
  ReferenceBreakdown,
  ReferenceScene,
  NarrativeMechanics,
  VisualPatterns,
  SubtitleMechanics,
  AppIntegrationPattern,
  AbstractedPattern,
  OriginalityGuide,
  TranscriptData,
} from '~~/shared/types/reference'
import { buildOriginalityPrompt, REFERENCE_ANALYZER_VERSION } from './reference-analyzer-agent'
import type { FrameAnalysisResult } from './video-frame-analyzer-agent'

export const VIDEO_SCENE_SYNTHESIZER_VERSION = '1.0.0'

export interface SceneSynthesisInput {
  ideaId: number
  sourceUrl: string
  platform: string | null
  title: string | null
  description: string | null
  authorName: string | null
  hashtags: string[]
  duration: string | null
  videoDurationSec: number | null
  thumbnailUrl: string | null
  transcript: TranscriptData | null
  frameAnalyses: FrameAnalysisResult[]
  appContext: string | null
}

interface StageAResult {
  sceneTimeline: ReferenceScene[]
  narrativeMechanics: NarrativeMechanics
  visualPatterns: VisualPatterns
  subtitleMechanics: SubtitleMechanics
  appIntegrationPattern: AppIntegrationPattern | null
}

const STAGE_A_SYSTEM = `Ты — Reference Pattern Analyst. У тебя есть пофреймовый анализ короткого видео и его транскрипт с таймкодами.
Твоя задача: восстановить sceneTimeline, narrativeMechanics, visualPatterns, subtitleMechanics, appIntegrationPattern.

КЛЮЧЕВОЕ ОТЛИЧИЕ от старой версии: у тебя есть РЕАЛЬНЫЕ ВИЗУАЛЬНЫЕ ДАННЫЕ из кадров с таймкодами и transcript с word-level segments. Ты НЕ должен додумывать визуал — он описан в frameAnalyses.

Источники истины:
1. frameAnalyses[].description / action / composition / cameraWork — единственная правда о визуале.
2. transcript.segments[] — единственная правда о словах и таймкодах.
3. metadata (title, hashtags, author) — контекст для интерпретации, не источник содержания.

Правила:
- sceneTimeline должен покрывать всю длительность видео без зазоров. Группируй кадры в 3-7 сцен по смене narrativeRole.
- onScreenText в сцене бери ТОЛЬКО из frameAnalyses[].onScreenText (то, что реально на экране), а не из transcript (то, что произнесено).
- emotionalArc — последовательность frameAnalyses[].emotionalTone, агрегированная по сценам.
- visualPatterns.colorPalette — самые частые из frameAnalyses[].dominantColors.
- subtitleMechanics.hasSubtitles = true если хотя бы 30% кадров имеют непустой onScreenText.
- appIntegrationPattern — null если ни один frameAnalyses[].hasAppUI === true.

Отвечай на русском, СТРОГО JSON-объектом без markdown.`

function buildStageAUserPrompt(input: SceneSynthesisInput): string {
  const transcriptShort = input.transcript
    ? {
        source: input.transcript.source,
        language: input.transcript.language,
        fullText: input.transcript.fullText.slice(0, 5000),
        segments: input.transcript.segments.slice(0, 80).map(s => ({
          start: Number(s.start.toFixed(2)),
          duration: Number(s.duration.toFixed(2)),
          text: s.text,
        })),
      }
    : null

  const metadata = {
    sourceUrl: input.sourceUrl,
    platform: input.platform,
    title: input.title,
    description: input.description?.slice(0, 800) ?? null,
    authorName: input.authorName,
    hashtags: input.hashtags,
    duration: input.duration,
    videoDurationSec: input.videoDurationSec,
    appContext: input.appContext,
  }

  return `## frameAnalyses (источник истины о визуале)
${JSON.stringify(input.frameAnalyses, null, 2)}

## transcript
${JSON.stringify(transcriptShort, null, 2)}

## metadata
${JSON.stringify(metadata, null, 2)}

## Задача
Верни JSON-объект со схемой:
{
  "sceneTimeline": ReferenceScene[],     // 3-7 сцен, покрывают всё видео
  "narrativeMechanics": {
    "hookType": "question|shock|story|pain_point|promise|visual|curiosity|transformation",
    "hookDescription": string,
    "bodyMechanic": string,
    "ctaMechanic": string,
    "emotionalArc": string[],
    "pacing": string,
    "narrativeTemplate": "transformation|discovery|challenge|comparison|day_in_life|social_proof",
    "transformationArc": string | null
  },
  "visualPatterns": {
    "colorPalette": string[],
    "lighting": string,
    "cameraStyle": string,
    "composition": string,
    "textOverlayStyle": string | null,
    "aesthetic": "minimal|bright|dark|cinematic|lo-fi|professional|raw" | string,
    "effects": string[]
  },
  "subtitleMechanics": {
    "hasSubtitles": boolean,
    "style": string | null,
    "placement": "top|center|bottom" | null,
    "rhythm": "per-word|per-phrase|per-sentence|continuous" | null,
    "textSize": string | null,
    "colorScheme": string | null
  },
  "appIntegrationPattern": null | {
    "integrationType": "organic|demo|before-after|testimonial|tutorial|overlay" | string,
    "timing": string,
    "organicScore": number,
    "description": string
  }
}

ReferenceScene = { order: number, startMarker: string, duration: string, action: string, purpose: string, onScreenText: string | null, visualCues: string, emotionalTone: string, cameraWork: string | null }

Ответь ТОЛЬКО JSON-объектом без markdown.`
}

function validateStageA(data: unknown): StageAResult {
  if (!data || typeof data !== 'object') {
    throw new Error('synthesizer stage A: ответ не объект')
  }
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.sceneTimeline) || !d.narrativeMechanics || !d.visualPatterns) {
    throw new Error('synthesizer stage A: нужны sceneTimeline, narrativeMechanics, visualPatterns')
  }
  return {
    sceneTimeline: d.sceneTimeline as ReferenceScene[],
    narrativeMechanics: d.narrativeMechanics as NarrativeMechanics,
    visualPatterns: d.visualPatterns as VisualPatterns,
    subtitleMechanics: (d.subtitleMechanics as SubtitleMechanics) || {
      hasSubtitles: false,
      style: null,
      placement: null,
      rhythm: null,
      textSize: null,
      colorScheme: null,
    },
    appIntegrationPattern: (d.appIntegrationPattern as AppIntegrationPattern | null) || null,
  }
}

function validateStageB(data: unknown): { abstractedPatterns: AbstractedPattern[]; originalityGuide: OriginalityGuide } {
  if (!data || typeof data !== 'object') {
    throw new Error('synthesizer stage B: ответ не объект')
  }
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.abstractedPatterns) || !d.originalityGuide) {
    throw new Error('synthesizer stage B: нужны abstractedPatterns и originalityGuide')
  }
  return {
    abstractedPatterns: d.abstractedPatterns as AbstractedPattern[],
    originalityGuide: d.originalityGuide as OriginalityGuide,
  }
}

/**
 * Синтез ReferenceBreakdown из frame-by-frame анализа + транскрипта.
 * Confidence: базовый расчёт + бонус за наличие frame-данных и транскрипта.
 */
export async function synthesizeReferenceFromFrames(input: SceneSynthesisInput): Promise<ReferenceBreakdown> {
  // Stage A
  const stageA = await callAnthropicAgent({
    systemPrompt: STAGE_A_SYSTEM,
    userPrompt: buildStageAUserPrompt(input),
    maxTokens: 4096,
    validate: validateStageA,
  })

  // Stage B — переиспользуем существующий prompt
  const stageB = await callAnthropicAgent({
    systemPrompt: `Ты — Originality Transformer. Преобразуешь конкретные креативные паттерны в абстрактные принципы, безопасные для переиспользования.
Никогда не копируешь конкретные фразы, заголовки, субтитры оригинала.
Всегда абстрагируешь до уровня принципа/механики.
Отвечай на русском. СТРОГО JSON.`,
    userPrompt: buildOriginalityPrompt(
      {
        sceneTimeline: stageA.sceneTimeline,
        narrativeMechanics: stageA.narrativeMechanics,
        visualPatterns: stageA.visualPatterns,
        subtitleMechanics: stageA.subtitleMechanics,
        appIntegrationPattern: stageA.appIntegrationPattern,
      },
      {
        sourceUrl: input.sourceUrl,
        platform: input.platform,
        mediaType: 'video',
        title: input.title,
        description: input.description,
        authorName: input.authorName,
        hashtags: input.hashtags,
        thumbnailUrl: input.thumbnailUrl,
        duration: input.duration,
        transcript: input.transcript,
        appContext: input.appContext,
      },
    ),
    maxTokens: 3072,
    validate: validateStageB,
  })

  // Confidence: базовая формула + бонусы за frame data и транскрипт
  const hasTranscript = !!input.transcript?.fullText && input.transcript.fullText.length > 0
  const hasTimedSegments = (input.transcript?.segments?.length ?? 0) > 0
  const hasDescription = !!input.description
  const hasThumbnail = !!input.thumbnailUrl
  const framesCount = input.frameAnalyses.length

  const baseFactors = [
    hasTranscript ? 0.15 : 0,
    hasTimedSegments ? 0.1 : 0,
    hasDescription ? 0.05 : 0,
    hasThumbnail ? 0.05 : 0,
    input.title ? 0.05 : 0,
    input.duration ? 0.05 : 0,
  ]
  let confidence = baseFactors.reduce((a, b) => a + b, 0)
  if (framesCount >= 8) confidence += 0.4
  else if (framesCount >= 4) confidence += 0.2
  if (hasTranscript) confidence += 0.2
  confidence = Math.max(0, Math.min(1, confidence))

  const metadataRichness: 'rich' | 'moderate' | 'sparse' = framesCount >= 6
    ? 'rich'
    : framesCount >= 3 || hasTranscript
      ? 'moderate'
      : 'sparse'

  const breakdown: ReferenceBreakdown = {
    version: REFERENCE_ANALYZER_VERSION,
    mediaType: 'video',
    transcript: input.transcript,
    sceneTimeline: stageA.sceneTimeline,
    narrativeMechanics: stageA.narrativeMechanics,
    visualPatterns: stageA.visualPatterns,
    subtitleMechanics: stageA.subtitleMechanics,
    appIntegrationPattern: stageA.appIntegrationPattern,
    abstractedPatterns: stageB.abstractedPatterns,
    originalityGuide: stageB.originalityGuide,
    confidence,
    dataAvailability: {
      hasTranscript,
      hasTimedSegments,
      hasThumbnail,
      hasDescription,
      metadataRichness,
    },
  }

  return breakdown
}
