/**
 * Video Content Analyzer — оркестратор скачивания, нарезки кадров и транскрипции
 * для импортированных видео в /ideas. Низкоуровневые операции делегируются в
 * подмодули `server/utils/video-tools/`.
 */

import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TranscriptData, TranscriptSegment } from '~~/shared/types/reference'
import type {
  MarketingFrameAnalysis,
  VideoAnalysisFramePass,
} from '~~/shared/types/video-analysis'
import {
  downloadVideoYtDlp,
  extractCaptionsViaYtDlp,
  type YtDlpDownloadResult,
} from './video-tools/yt-dlp'
import {
  extractFramesFfmpeg,
  extractAudioMp3,
  extractFramesParallel,
  getVideoDuration,
  type ExtractedFrameFile,
} from './video-tools/ffmpeg'
import { parseSrtToSegments, parseVttToSegments } from './video-tools/subtitle-parsers'
import { detectSceneBoundaries } from './video-tools/scene-detect'
import { pickTimestamps } from './video-tools/frame-strategy'
import { clearFrameDir, getFrameDir } from './video-tools/frame-storage'
import {
  analyzeFramesMarketing,
  type MarketingFrameContext,
  type MarketingFrameInput,
} from './agents/video-frame-analyzer-marketing'
import { withTimeoutAndRetry } from './external-call'

export interface VideoDownloadResult {
  filePath: string
  bytes: number
  durationSec: number | null
  resolvedFormat: string
}

export interface FrameExtractionOptions {
  count?: number
  outputDir: string
  width?: number
}

export interface ExtractedFrame extends ExtractedFrameFile {}

/** Сформировать путь /tmp/zavodcamp-analysis-<ideaId>-<uuid>/ */
export function buildIdeaWorkDir(ideaId: number): string {
  return join(tmpdir(), `zavodcamp-analysis-${ideaId}-${randomUUID()}`)
}

/** Скачать видео по URL в workDir. Создаёт workDir если его нет. */
export async function downloadVideo(url: string, workDir: string): Promise<VideoDownloadResult> {
  await mkdir(workDir, { recursive: true })
  const result: YtDlpDownloadResult = await downloadVideoYtDlp(url, workDir)
  return {
    filePath: result.filePath,
    bytes: result.bytes,
    durationSec: result.durationSec,
    resolvedFormat: result.resolvedFormat,
  }
}

/** Извлечь N кадров через ffmpeg. */
export async function extractFrames(
  videoPath: string,
  options: FrameExtractionOptions,
): Promise<ExtractedFrame[]> {
  const count = options.count ?? 12
  const width = options.width ?? 720
  return extractFramesFfmpeg(videoPath, count, options.outputDir, width)
}

/**
 * Транскрипция в трёх уровнях:
 *  0) для youtube — extractYouTubeTranscript из transcript-extractor.ts (timedText API, мгновенно)
 *  1) yt-dlp captions (vtt) — бесплатно
 *  2) fal-ai/whisper — платно, fallback
 *
 * Если все три упали — возвращаем заглушку source='unavailable' (НЕ throw).
 */
export async function transcribeVideo(
  sourceUrl: string,
  localVideoPath: string,
  workDir: string,
): Promise<TranscriptData> {
  // Шаг 0 — timedText API для YouTube
  if (/youtube\.com|youtu\.be/i.test(sourceUrl)) {
    try {
      const { extractTranscript } = await import('./transcript-extractor')
      const yt = await extractTranscript(sourceUrl, 'youtube')
      if (yt && yt.fullText && yt.fullText.length > 0 && yt.segments.length > 0) {
        return yt
      }
    }
    catch { /* graceful fallback */ }
  }

  // Шаг 1 — yt-dlp auto/native captions
  try {
    const captions = await extractCaptionsViaYtDlp(sourceUrl, workDir, ['ru', 'en'])
    if (captions) {
      const raw = await readFile(captions.filePath, 'utf-8').catch(() => '')
      let segments: TranscriptSegment[] = []
      if (captions.filePath.endsWith('.vtt')) {
        segments = parseVttToSegments(raw)
      }
      else if (captions.filePath.endsWith('.srt')) {
        segments = parseSrtToSegments(raw)
      }
      if (segments.length > 0) {
        const fullText = segments.map(s => s.text).join(' ')
        const platform = /youtube\.com|youtu\.be/i.test(sourceUrl) ? 'youtube_captions' : 'platform_captions'
        return {
          fullText,
          segments,
          source: platform as TranscriptData['source'],
          language: captions.lang || null,
        }
      }
    }
  }
  catch { /* graceful fallback */ }

  // Шаг 2 — fal-ai/whisper (платно)
  try {
    const audioPath = join(workDir, 'audio.mp3')
    await extractAudioMp3(localVideoPath, audioPath)

    requirePaidApisEnabled('Whisper transcription via fal.ai')

    const audioUrl = await falUploadFile(audioPath, 'audio/mpeg')
    // Whisper транскрипция: hard timeout 10 минут per attempt, 2 retry.
    // Whisper обычно занимает 10-60 секунд на короткое видео, до 5 минут на длинные.
    // 10 минут с запасом, чтобы pipeline не висел forever если fal.ai застрянет.
    const whisperResult = await withTimeoutAndRetry<{
      text?: string
      chunks?: Array<{ timestamp: [number, number]; text: string }>
      inferred_languages?: string[]
    }>(
      () => falRequest<{
        text?: string
        chunks?: Array<{ timestamp: [number, number]; text: string }>
        inferred_languages?: string[]
      }>('fal-ai/whisper', {
        audio_url: audioUrl,
        task: 'transcribe',
        chunk_level: 'segment',
      }),
      {
        label: 'Whisper transcription',
        timeoutMs: 10 * 60 * 1000,
        maxRetries: 2,
        initialBackoffMs: 3000,
      },
    )

    const chunks = Array.isArray(whisperResult?.chunks) ? whisperResult.chunks : []
    const segments: TranscriptSegment[] = chunks
      .filter(c => c && Array.isArray(c.timestamp) && c.timestamp.length === 2 && typeof c.text === 'string')
      .map((c) => {
        const start = Number(c.timestamp[0]) || 0
        const end = Number(c.timestamp[1]) || start
        return {
          start,
          duration: Math.max(0, end - start),
          text: c.text.trim(),
        }
      })
      .filter(s => s.text.length > 0)

    const fullText = (whisperResult?.text || segments.map(s => s.text).join(' ')).trim()
    const language = whisperResult?.inferred_languages?.[0] || null

    if (fullText.length > 0) {
      return { fullText, segments, source: 'whisper', language }
    }
  }
  catch (err) {
    try {
      await logAgent(
        'video-content-analyzer',
        'warn',
        `transcribeVideo: whisper-этап упал — ${err instanceof Error ? err.message : 'unknown'}`,
        { sourceUrl },
      )
    }
    catch { /* ignore */ }
  }

  // Все ветки упали — возвращаем заглушку
  return { fullText: '', segments: [], source: 'unavailable', language: null }
}

/** Удалить workDir рекурсивно. Не падает, если директории нет. */
export async function cleanupWorkDir(workDir: string): Promise<void> {
  if (!workDir) return
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
}

// ─── Marketing-grade Creative Video Analysis (Этап 2) ────────────────────────

const FRAMEPASS_VERSION_DEFAULT = 'frames-v1'
const FRAMEPASS_TTL_MS = 30 * 24 * 60 * 60_000 // 30 дней

export interface AnalyzeCreativeVideoOptions {
  /** Игнорировать TTL и принудительно перезапустить анализ. */
  force?: boolean
  /** Override версии (для миграций промпта). По умолчанию 'frames-v1'. */
  framePassVersion?: string
  /** Override метаданных приложения (если у Video.scenario нет appId). */
  appName?: string | null
  appAudience?: string | null
  appGeo?: string | null
}

export interface AnalyzeCreativeVideoResult {
  videoId: number
  framesExtracted: number
  framesSentToAi: number
  framesSkipped: number[]
  framePassVersion: string
  framePassRunAt: Date
  durationSec: number
  fitScore: number | null
  skipped: boolean
  reason?: string
}

function isFreshFramePass(
  framePassVersion: string | null,
  framePassRunAt: Date | null,
  expectedVersion: string,
): boolean {
  if (!framePassRunAt) return false
  if (framePassVersion !== expectedVersion) return false
  return Date.now() - framePassRunAt.getTime() < FRAMEPASS_TTL_MS
}

/**
 * Marketing-grade покадровый разбор импортированного видео.
 *
 * Pipeline:
 *  1. Load Video + scenario.appId + driveFile
 *  2. Resolve локальный путь (`Video.filePath` или `driveFile.localPath`)
 *  3. TTL-check: если framePass свежий и не `force` — skip
 *  4. probe duration (fluent-ffmpeg)
 *  5. scene-detect (best-effort, на ошибке → пустой массив)
 *  6. pickTimestamps(adaptive count + scene snap)
 *  7. clearFrameDir + extractFramesParallel (4 воркера, downscale fallback)
 *  8. VideoFrame.deleteMany + createMany (без description/keyElements)
 *  9. base64-encode каждый кадр + build MarketingFrameContext
 * 10. analyzeFramesMarketing → MarketingFrameAnalysis
 * 11. transaction: Video.update(analysisData, framePass*, fitScore, fitRationale)
 *     + per-frame VideoFrame.update(description, keyElements)
 * 12. Return summary. Cleanup НЕ делается — кадры остаются persistent.
 */
export async function analyzeCreativeVideo(
  videoId: number,
  options: AnalyzeCreativeVideoOptions = {},
): Promise<AnalyzeCreativeVideoResult> {
  const framePassVersion = options.framePassVersion ?? FRAMEPASS_VERSION_DEFAULT

  // 1. Load Video + relations
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: {
      scenario: { select: { appId: true } },
      driveFile: { select: { localPath: true } },
    },
  })
  if (!video) {
    throw new Error(`Видео #${videoId} не найдено`)
  }

  // 2. Resolve source filePath
  const sourcePath = video.filePath || video.driveFile?.localPath || null
  if (!sourcePath) {
    throw new Error(
      `Видео #${videoId} не имеет локального файла (Video.filePath и DriveFile.localPath пусты).`
        + ' Скачайте видео перед анализом.',
    )
  }

  // 3. TTL skip
  if (!options.force && isFreshFramePass(video.framePassVersion, video.framePassRunAt, framePassVersion)) {
    return {
      videoId,
      framesExtracted: 0,
      framesSentToAi: 0,
      framesSkipped: [],
      framePassVersion: video.framePassVersion ?? framePassVersion,
      framePassRunAt: video.framePassRunAt ?? new Date(),
      durationSec: video.analysisDurationSec ?? 0,
      fitScore: video.fitScore ?? null,
      skipped: true,
      reason: 'TTL свежий — повторный анализ пропущен',
    }
  }

  // 4. Probe duration
  const durationSec = await getVideoDuration(sourcePath)
  if (!durationSec || durationSec <= 0) {
    throw new Error(`Не удалось определить длительность видео #${videoId} (${sourcePath})`)
  }

  // 5. Scene detection (best-effort)
  let scenes: Awaited<ReturnType<typeof detectSceneBoundaries>> = []
  try {
    scenes = await detectSceneBoundaries(sourcePath, 0.4)
  }
  catch {
    scenes = []
  }

  // 6. pickTimestamps
  const timestamps = pickTimestamps(durationSec, scenes)
  if (timestamps.length === 0) {
    throw new Error(`Не удалось выбрать таймкоды для видео #${videoId} (duration=${durationSec})`)
  }

  // 7. Frame extraction
  await clearFrameDir(videoId)
  const frameDir = getFrameDir(videoId)
  const extracted = await extractFramesParallel(sourcePath, timestamps, frameDir)
  if (extracted.length === 0) {
    throw new Error(`ffmpeg не извлёк ни одного кадра для видео #${videoId}`)
  }

  // 8. Replace VideoFrame rows (без description/keyElements — backfill после AI)
  await prisma.videoFrame.deleteMany({ where: { videoId } })
  await prisma.videoFrame.createMany({
    data: extracted.map(f => ({
      videoId,
      sequence: f.sequence,
      timestampSec: f.timestampSec,
      filePath: f.filePath,
      width: f.width,
      height: f.height,
      isSceneBoundary: f.isSceneBoundary,
    })),
  })

  // 9. Build marketing inputs (base64-encode каждый кадр)
  const inputs: MarketingFrameInput[] = []
  const skipped: number[] = []
  for (const f of extracted) {
    try {
      const buf = await readFile(f.filePath)
      inputs.push({
        sequence: f.sequence,
        timestampSec: f.timestampSec,
        base64Image: buf.toString('base64'),
        mimeType: 'image/jpeg',
        isSceneBoundary: f.isSceneBoundary,
      })
    }
    catch {
      skipped.push(f.sequence)
    }
  }
  if (inputs.length === 0) {
    throw new Error(`Все кадры пропущены при чтении (видео #${videoId})`)
  }

  // 10. Resolve App context
  let appName: string | null = options.appName ?? null
  let appAudience: string | null = options.appAudience ?? null
  let appGeo: string | null = options.appGeo ?? null
  const appId = video.scenario?.appId ?? null
  if (appId && (appName === null || appAudience === null || appGeo === null)) {
    const app = await prisma.app.findUnique({
      where: { id: appId },
      select: { name: true, targetAudience: true, geo: true },
    })
    if (app) {
      if (appName === null) appName = app.name
      if (appAudience === null) appAudience = app.targetAudience ?? null
      if (appGeo === null) appGeo = app.geo ?? null
    }
  }

  const context: MarketingFrameContext = {
    videoTitle: null,
    durationSec,
    width: extracted[0]?.width ?? null,
    height: extracted[0]?.height ?? null,
    format: video.format ?? null,
    language: null,
    platform: video.targetPlatform ?? null,
    appName,
    appAudience,
    appGeo,
  }

  // 11. AI call
  const marketing: MarketingFrameAnalysis = await analyzeFramesMarketing(inputs, context)

  // 12. DB transaction
  const runAt = new Date()
  const framePass: VideoAnalysisFramePass = {
    modeVersion: framePassVersion,
    mode: 'marketing',
    runAt: runAt.toISOString(),
    durationSec,
    framesExtracted: extracted.length,
    framesSentToAi: inputs.length,
    framesSkipped: skipped,
    result: marketing,
  }

  await prisma.$transaction(async (tx) => {
    await tx.video.update({
      where: { id: videoId },
      data: {
        analysisData: framePass as unknown as object,
        framePassVersion,
        framePassRunAt: runAt,
        analysisDurationSec: durationSec,
        fitScore: marketing.fitScore,
        fitRationale: marketing.fitRationale,
      },
    })
    for (const fd of marketing.frameDescriptions) {
      await tx.videoFrame.updateMany({
        where: { videoId, sequence: fd.sequence },
        data: {
          description: fd.description,
          keyElements: fd.keyElements as unknown as object,
        },
      })
    }
  })

  return {
    videoId,
    framesExtracted: extracted.length,
    framesSentToAi: inputs.length,
    framesSkipped: skipped,
    framePassVersion,
    framePassRunAt: runAt,
    durationSec,
    fitScore: marketing.fitScore,
    skipped: false,
  }
}
