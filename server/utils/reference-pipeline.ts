/**
 * Reference Analysis Pipeline.
 *
 * Полный flow для импортированных видео:
 *  1. download (yt-dlp)
 *  2. extractFrames (ffmpeg)
 *  3. transcribeVideo (yt-dlp captions / fal whisper)
 *  4. analyzeAllFramesBatch (Anthropic vision, ОДИН call с N image-блоками)
 *  5. synthesizeReferenceFromFrames (Anthropic Sonnet, 2 stage)
 *  6. сохранение IdeaAnalysis.referenceBreakdown
 *
 * Для mediaType='image'/'unknown' — fallback на старый text-only `analyzeReference`.
 *
 * Concurrency: глобальный счётчик `runningAnalyses` с лимитом MAX_CONCURRENT_ANALYSES.
 * Helpers `tryAcquireAnalysisSlot()` / `releaseAnalysisSlot()` дают endpoint синхронно
 * проверить лимит ДО запуска fire-and-forget.
 */

import { fetchVideoMetadata } from './video-metadata'
import { detectMediaType } from './transcript-extractor'
import { analyzeReference, REFERENCE_ANALYZER_VERSION } from './agents/reference-analyzer-agent'
import {
  buildIdeaWorkDir,
  cleanupWorkDir,
  downloadVideo,
  extractFrames,
  transcribeVideo,
} from './video-content-analyzer'
import { analyzeAllFramesBatch, type FrameAnalysisInput } from './agents/video-frame-analyzer-agent'
import { synthesizeReferenceFromFrames } from './agents/video-scene-synthesizer-agent'
import type { ReferenceBreakdown, ReferenceProgress, ReferenceProgressStage, TranscriptData, TranscriptSegment } from '~~/shared/types/reference'
import type { Prisma } from '../../app/generated/prisma/client'

export interface ReferenceAnalysisResult {
  breakdown: ReferenceBreakdown
  transcriptExtracted: boolean
  errors: string[]
}

// --- Concurrency ---

let runningAnalyses = 0
const MAX_CONCURRENT_ANALYSES = 2

export class ConcurrencyLimitError extends Error {
  code = 'CONCURRENCY_LIMIT'
  constructor(msg: string) {
    super(msg)
    this.name = 'ConcurrencyLimitError'
  }
}

/** Синхронно зарезервировать слот. true если успех, false если уже max. */
export function tryAcquireAnalysisSlot(): boolean {
  if (runningAnalyses >= MAX_CONCURRENT_ANALYSES) return false
  runningAnalyses++
  return true
}

/** Освободить слот. Вызывать в finally fire-and-forget обёртки. */
export function releaseAnalysisSlot(): void {
  if (runningAnalyses > 0) runningAnalyses--
}

// --- Progress throttling ---

const lastProgressUpdateAt = new Map<number, number>()
const progressStartedAt = new Map<number, number>()
const PROGRESS_THROTTLE_MS = 500

async function updateProgress(
  ideaId: number,
  partial: Partial<ReferenceProgress>,
  options: { force?: boolean } = {},
): Promise<void> {
  const now = Date.now()
  const last = lastProgressUpdateAt.get(ideaId) || 0
  if (!options.force && now - last < PROGRESS_THROTTLE_MS) return
  lastProgressUpdateAt.set(ideaId, now)

  let startedAt = progressStartedAt.get(ideaId)
  if (!startedAt) {
    startedAt = Date.now()
    progressStartedAt.set(ideaId, startedAt)
  }

  const startedAtIso = partial.startedAt || new Date(startedAt).toISOString()
  const elapsedSec = Math.max(0, Math.round((now - startedAt) / 1000))

  const payload: ReferenceProgress = {
    stage: partial.stage || 'queued',
    framesDone: partial.framesDone,
    framesTotal: partial.framesTotal,
    elapsedSec,
    startedAt: startedAtIso,
  }

  await prisma.idea.update({
    where: { id: ideaId },
    data: { analysisProgress: JSON.stringify(payload) },
  }).catch(() => { /* не критично — UI просто покажет старое состояние */ })
}

function nearbySubtitlesFor(segments: TranscriptSegment[], ts: number, windowSec: number = 1.5): TranscriptSegment[] {
  if (!segments || segments.length === 0) return []
  return segments.filter((s) => {
    const segStart = s.start
    const segEnd = s.start + s.duration
    return segEnd >= ts - windowSec && segStart <= ts + windowSec
  })
}

// --- Image branch (fallback на text-only анализ) ---

interface ImageBranchInput {
  sourceUrl: string
  title: string | null
  body: string | null
  appId: number | null
  thumbnailUrl: string | null
  tags: string[] | null
  analysis: { id: number } | null
}

async function runImageBranch(ideaId: number, idea: ImageBranchInput): Promise<ReferenceAnalysisResult> {
  const errors: string[] = []
  const metadata = await fetchVideoMetadata(idea.sourceUrl)
  const breakdown = await analyzeReference({
    sourceUrl: idea.sourceUrl,
    platform: metadata.platform,
    mediaType: 'image',
    title: metadata.title || idea.title,
    description: metadata.description || idea.body,
    authorName: metadata.authorName,
    hashtags: metadata.hashtags.length > 0 ? metadata.hashtags : (idea.tags || []),
    thumbnailUrl: metadata.thumbnailUrl,
    duration: metadata.duration,
    transcript: null,
    appContext: idea.appId ? `appId: ${idea.appId}` : null,
  })
  await persistBreakdown(ideaId, breakdown, idea.analysis, metadata)
  return { breakdown, transcriptExtracted: false, errors }
}

async function persistBreakdown(
  ideaId: number,
  breakdown: ReferenceBreakdown,
  existingAnalysis: { id: number } | null,
  metadata: Awaited<ReturnType<typeof fetchVideoMetadata>>,
): Promise<void> {
  const breakdownJson = JSON.parse(JSON.stringify(breakdown)) as Prisma.InputJsonValue

  if (existingAnalysis) {
    await prisma.ideaAnalysis.update({
      where: { id: existingAnalysis.id },
      data: {
        referenceBreakdown: breakdownJson,
        referenceVersion: REFERENCE_ANALYZER_VERSION,
      },
    })
  }
  else {
    await prisma.ideaAnalysis.create({
      data: {
        ideaId,
        hookAnalysis: JSON.parse(JSON.stringify(breakdown.narrativeMechanics)) as Prisma.InputJsonValue,
        sceneStructure: {
          estimatedDuration: metadata.duration || 'неизвестно',
          scenes: breakdown.sceneTimeline.map(s => ({
            order: s.order,
            name: s.action.slice(0, 50),
            description: s.action,
            estimatedDuration: s.duration,
            purpose: s.purpose,
          })),
          narrativeArc: breakdown.narrativeMechanics.narrativeTemplate,
          pacingNotes: breakdown.narrativeMechanics.pacing,
        },
        visualStyle: JSON.parse(JSON.stringify(breakdown.visualPatterns)) as Prisma.InputJsonValue,
        viralityReasons: {
          primaryReason: 'Определено через reference analysis',
          factors: [],
          targetAudience: 'Определяется по контексту',
          replicability: Math.round(breakdown.confidence * 100),
          replicabilityNotes: `Reference analysis confidence: ${breakdown.confidence}`,
        },
        summary: `Reference analysis: ${breakdown.narrativeMechanics.narrativeTemplate} video, ${breakdown.sceneTimeline.length} scenes`,
        modelVersion: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        promptVersion: `reference-${REFERENCE_ANALYZER_VERSION}`,
        confidence: breakdown.confidence,
        referenceBreakdown: breakdownJson,
        referenceVersion: REFERENCE_ANALYZER_VERSION,
      },
    })
  }
}

// --- Main pipeline ---

/**
 * Полный pipeline анализа референса. Вызывается через `tryAcquireAnalysisSlot()` →
 * fire-and-forget. Слот освобождает caller (endpoint) после завершения / ошибки.
 *
 * Если concurrency не зарезервирована — бросает ConcurrencyLimitError и НЕ меняет БД.
 */
export async function analyzeIdeaReference(ideaId: number): Promise<ReferenceAnalysisResult> {
  const errors: string[] = []
  progressStartedAt.set(ideaId, Date.now())
  await updateProgress(ideaId, { stage: 'queued' }, { force: true })

  const idea = await prisma.idea.findUnique({
    where: { id: ideaId },
    include: {
      analysis: true,
      app: { select: { id: true, name: true } },
    },
  })
  if (!idea) throw new Error(`Идея ${ideaId} не найдена`)
  if (!idea.sourceUrl) throw new Error('URL источника не указан')

  const sourceUrl = idea.sourceUrl
  const detectedMediaType = detectMediaType(sourceUrl)

  // Image branch — без download/frames/transcribe
  if (detectedMediaType === 'image' || detectedMediaType === 'unknown') {
    requirePaidApisEnabled('Anthropic Claude API')
    await prisma.idea.update({
      where: { id: ideaId },
      data: { mediaType: detectedMediaType },
    })
    const result = await runImageBranch(ideaId, {
      sourceUrl,
      title: idea.title,
      body: idea.body,
      appId: idea.appId,
      thumbnailUrl: idea.thumbnailUrl,
      tags: idea.tags,
      analysis: idea.analysis ? { id: idea.analysis.id } : null,
    })
    await prisma.idea.update({
      where: { id: ideaId },
      data: { referenceStatus: 'completed', analysisProgress: null },
    })
    progressStartedAt.delete(ideaId)
    lastProgressUpdateAt.delete(ideaId)
    return result
  }

  // Видео-branch
  requirePaidApisEnabled('Anthropic Claude API')
  const metadata = await fetchVideoMetadata(sourceUrl)
  await prisma.idea.update({
    where: { id: ideaId },
    data: {
      mediaType: 'video',
      thumbnailUrl: metadata.thumbnailUrl || idea.thumbnailUrl,
      platform: metadata.platform || idea.platform,
    },
  })

  const workDir = buildIdeaWorkDir(ideaId)

  try {
    // Stage 1: download
    await updateProgress(ideaId, { stage: 'downloading' as ReferenceProgressStage }, { force: true })
    const download = await downloadVideo(sourceUrl, workDir)

    // Stage 2: extract frames
    await updateProgress(ideaId, { stage: 'extracting_frames' as ReferenceProgressStage }, { force: true })
    const frames = await extractFrames(download.filePath, {
      count: 12,
      outputDir: `${workDir}/frames`,
      width: 720,
    })

    // Stage 3: transcribe
    await updateProgress(ideaId, { stage: 'transcribing' as ReferenceProgressStage }, { force: true })
    const transcript: TranscriptData = await transcribeVideo(sourceUrl, download.filePath, workDir)
    if (transcript.fullText.length > 0) {
      await prisma.idea.update({
        where: { id: ideaId },
        data: { transcription: transcript.fullText, language: transcript.language },
      }).catch(() => {})
    }

    // Stage 4: analyze frames batch
    await updateProgress(
      ideaId,
      { stage: 'analyzing_frames' as ReferenceProgressStage, framesDone: 0, framesTotal: frames.length },
      { force: true },
    )
    const frameInputs: FrameAnalysisInput[] = frames.map(f => ({
      frame: f,
      nearbySubtitles: nearbySubtitlesFor(transcript.segments, f.timestampSec),
      totalFrames: frames.length,
      videoDurationSec: download.durationSec ?? null,
      ideaTitle: idea.title || metadata.title || null,
      appName: idea.app?.name || null,
    }))
    const frameResults = await analyzeAllFramesBatch(frameInputs)
    await updateProgress(
      ideaId,
      { stage: 'analyzing_frames' as ReferenceProgressStage, framesDone: frames.length, framesTotal: frames.length },
      { force: true },
    )

    // Stage 5: synthesize
    await updateProgress(ideaId, { stage: 'synthesizing' as ReferenceProgressStage }, { force: true })
    const breakdown = await synthesizeReferenceFromFrames({
      ideaId,
      sourceUrl,
      platform: metadata.platform || idea.platform,
      title: metadata.title || idea.title,
      description: metadata.description || idea.body,
      authorName: metadata.authorName,
      hashtags: metadata.hashtags.length > 0 ? metadata.hashtags : (idea.tags || []),
      duration: metadata.duration,
      videoDurationSec: download.durationSec ?? null,
      thumbnailUrl: metadata.thumbnailUrl,
      transcript: transcript.fullText.length > 0 ? transcript : null,
      frameAnalyses: frameResults,
      appContext: idea.appId ? `appId: ${idea.appId}, app: ${idea.app?.name || ''}` : null,
    })

    // Stage 6: persist
    await persistBreakdown(ideaId, breakdown, idea.analysis ? { id: idea.analysis.id } : null, metadata)
    await prisma.idea.update({
      where: { id: ideaId },
      data: { referenceStatus: 'completed', analysisProgress: null, errorMessage: null },
    })

    return { breakdown, transcriptExtracted: transcript.fullText.length > 0, errors }
  }
  finally {
    await cleanupWorkDir(workDir)
    progressStartedAt.delete(ideaId)
    lastProgressUpdateAt.delete(ideaId)
  }
}
