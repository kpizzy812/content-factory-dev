/**
 * Pipeline executor: video_analyzer.
 *
 * Принимает upstream output: либо driveFileIds (от google_drive_scanner),
 * либо videoIds (от другой ноды). Импортирует Drive-файлы в Video через
 * importDriveFileToVideo helper, затем запускает analyzeCreativeVideo для
 * каждого с concurrency-limiter (default 2, range 1..3).
 *
 * Не-фатальные ошибки per-video — push в failed[]. Status='success' если хотя
 * бы один проанализирован, 'failed' если все упали.
 */
import { prisma } from "./prisma"
import { analyzeCreativeVideo } from "./video-content-analyzer"
import { importDriveFileToVideo } from "./google-drive/import"
import { throwIfAborted } from "./pipeline-cancel-registry"
import { logAgent } from "./agent-logger"

interface VideoAnalyzerConfig {
  force?: boolean
  concurrency?: number
}

function validateConfig(config: Record<string, unknown>): VideoAnalyzerConfig {
  const force = Boolean(config.force ?? false)
  let concurrency = Number(config.concurrency ?? 2)
  if (!Number.isFinite(concurrency) || concurrency < 1) concurrency = 2
  if (concurrency > 3) concurrency = 3
  return { force, concurrency }
}

/**
 * Простой concurrency limiter (по образцу runWithLimit из video-tools/ffmpeg.ts).
 */
async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const queue = items.map((item, index) => ({ item, index }))
  const workers: Promise<void>[] = []
  const workerCount = Math.min(limit, queue.length)
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (queue.length) {
          const next = queue.shift()
          if (!next) return
          results[next.index] = await fn(next.item, next.index)
        }
      })(),
    )
  }
  await Promise.all(workers)
  return results
}

/**
 * Конвертирует upstream driveFileIds в videoIds через importDriveFileToVideo.
 * Если DriveFile.videoId уже есть — переиспользуем (idempotent re-run).
 * Файлы с syncStatus !== 'downloaded' пропускаем (push в skipped).
 */
async function resolveDriveFileIds(
  driveFileIds: number[],
  userId: number,
  applicationId: number | undefined,
  signal?: AbortSignal,
): Promise<{
  videoIds: number[]
  imported: number
  skipped: Array<{ driveFileId: number; reason: string }>
  failed: Array<{ driveFileId: number; error: string }>
}> {
  const videoIds: number[] = []
  const skipped: Array<{ driveFileId: number; reason: string }> = []
  const failed: Array<{ driveFileId: number; error: string }> = []
  let imported = 0

  for (const id of driveFileIds) {
    throwIfAborted(signal)
    const file = await prisma.driveFile.findUnique({
      where: { id },
      select: { id: true, videoId: true, syncStatus: true, name: true },
    })
    if (!file) {
      skipped.push({ driveFileId: id, reason: "DriveFile не найден" })
      continue
    }
    if (file.videoId) {
      videoIds.push(file.videoId)
      continue
    }
    if (file.syncStatus !== "downloaded") {
      skipped.push({
        driveFileId: id,
        reason: `syncStatus=${file.syncStatus} (нужно сначала скачать)`,
      })
      continue
    }
    try {
      const result = await importDriveFileToVideo({
        driveFileId: id,
        userId,
        applicationId,
        format: "portrait",
      })
      videoIds.push(result.videoId)
      imported++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failed.push({ driveFileId: id, error: message })
    }
  }

  return { videoIds, imported, skipped, failed }
}

export async function executeVideoAnalyzerNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const cfg = validateConfig(config)
  throwIfAborted(signal)

  // Resolve userId через WorkflowRun (нужен для importDriveFileToVideo).
  const runId = Number(input._runId)
  let userId: number | null = null
  let applicationIdFromPipeline: number | undefined

  if (Number.isFinite(runId) && runId > 0) {
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { pipeline: { select: { userId: true } } },
    })
    userId = run?.pipeline?.userId ?? null
  }

  // applicationId из upstream (scanner может прокинуть, либо из пер-ноды config)
  const cfgAppId = Number(input.applicationId ?? Number.NaN)
  if (Number.isFinite(cfgAppId) && cfgAppId > 0) {
    applicationIdFromPipeline = cfgAppId
  }

  // ── Resolve videoIds ──
  let resolvedVideoIds: number[] = []
  let imported = 0
  const skipped: Array<{ driveFileId: number; reason: string }> = []
  const importFailed: Array<{ driveFileId: number; error: string }> = []

  const upstreamDriveFileIds = Array.isArray(input.driveFileIds)
    ? (input.driveFileIds as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : []
  const upstreamVideoIds = Array.isArray(input.videoIds)
    ? (input.videoIds as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : []

  if (upstreamDriveFileIds.length > 0) {
    if (!userId) {
      throw new Error("VideoAnalyzer: не удалось определить userId для импорта DriveFile")
    }
    const result = await resolveDriveFileIds(
      upstreamDriveFileIds,
      userId,
      applicationIdFromPipeline,
      signal,
    )
    resolvedVideoIds = result.videoIds
    imported = result.imported
    skipped.push(...result.skipped)
    importFailed.push(...result.failed)
  } else if (upstreamVideoIds.length > 0) {
    resolvedVideoIds = upstreamVideoIds
  } else {
    return {
      videoIds: [],
      _noData: true,
      _domainStatus: "no_data",
      _noDataReason: "Не передан upstream output с driveFileIds или videoIds",
    }
  }

  if (resolvedVideoIds.length === 0) {
    return {
      videoIds: [],
      summary: {
        processed: 0,
        skipped: skipped.length,
        failed: importFailed.length,
        imported,
      },
      _noData: true,
      _domainStatus: "no_data",
      _noDataReason: "Все upstream файлы пропущены (не скачаны или ошибка импорта)",
      ...(importFailed.length > 0 ? { importFailedDetails: importFailed.slice(0, 5) } : {}),
    }
  }

  throwIfAborted(signal)

  // ── Запускаем анализ с concurrency ──
  const analyzeResults = await runWithLimit(
    resolvedVideoIds,
    cfg.concurrency ?? 2,
    async (videoId) => {
      throwIfAborted(signal)
      try {
        const r = await analyzeCreativeVideo(videoId, { force: cfg.force })
        return { videoId, ok: true, skipped: r.skipped, fitScore: r.fitScore }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await logAgent(
          "video_analyzer_node",
          "error",
          `analyzeCreativeVideo failed for video ${videoId}: ${message}`,
          { videoId, error: message },
        ).catch(() => {})
        return { videoId, ok: false, error: message }
      }
    },
  )

  const processed = analyzeResults.filter((r) => r.ok && !r.skipped)
  const skippedAnalysis = analyzeResults.filter((r) => r.ok && r.skipped)
  const failed = analyzeResults.filter((r) => !r.ok)

  // Если все упали — это failure ноды.
  if (failed.length === resolvedVideoIds.length && resolvedVideoIds.length > 0) {
    throw new Error(
      `VideoAnalyzer: все ${failed.length} видео не удалось проанализировать. `
        + `Первая ошибка: ${failed[0]?.error ?? "unknown"}`,
    )
  }

  // videos[].id для downstream (Caption Generator берёт video из этого массива).
  const videos = resolvedVideoIds.map((id) => {
    const r = analyzeResults.find((x) => x.videoId === id)
    return {
      id,
      fitScore: r?.fitScore ?? null,
      status: r?.ok ? (r.skipped ? "skipped_ttl" : "analyzed") : "failed",
    }
  })

  return {
    videoIds: resolvedVideoIds,
    videos,
    analysisIds: processed.map((r) => r.videoId),
    summary: {
      processed: processed.length,
      skipped: skippedAnalysis.length,
      failed: failed.length,
      imported,
      driveFilesSkipped: skipped.length,
    },
    ...(failed.length > 0
      ? { _domainDegraded: true, failedCount: failed.length, generatedCount: processed.length }
      : {}),
  }
}
