/**
 * Контур проверки похожести готового ролика перед публикацией
 * (docs/PROJECT_CONTEXT.md п.7).
 *
 * Порядок работы: посчитать перцептивный отпечаток отрендеренного файла →
 * поднять отпечатки последних опубликованных роликов того же приложения →
 * сравнить → отдать результат гейту.
 *
 * ПОЧЕМУ зависимости внедряются: и ffmpeg, и БД здесь неизбежны, но сам порядок
 * работы и обработка отказов обязаны проверяться тестом без процесса и без базы.
 * Импорты тяжёлых модулей — динамические ровно по той же причине, что и в
 * `policy-judge.ts`: файл должен грузиться в DB-free тестах.
 *
 * КЛЮЧЕВОЕ ПОВЕДЕНИЕ: функция никогда не бросает. Неудача — это ДАННЫЕ для
 * гейта («уникальность не проверена» = блокирующий чек), а не падение всего узла.
 */

import type {
  FingerprintHistoryEntry,
  VideoFingerprint,
  VideoUniquenessOutcome,
} from './video-fingerprint'
import {
  FINGERPRINT_HISTORY_LIMIT,
  buildVideoFingerprint,
  extractFingerprintFromChecks,
  findFingerprintDuplicates,
  pickFingerprintGridTimestamps,
  pickFingerprintTimestamps,
} from './video-fingerprint'

export interface UniquenessVideoSource {
  id?: number | null
  storageKey?: string | null
  filePath?: string | null
  fileUrl?: string | null
  /** Длительность из БД. Если её нет — снимем ffprobe'ом. */
  duration?: number | null
}

export interface UniquenessCoverSource {
  storageKey?: string | null
  filePath?: string | null
}

export interface VideoUniquenessInput {
  appId: number
  video: UniquenessVideoSource | null
  cover?: UniquenessCoverSource | null
  /** false — контур выключен конфигом узла. */
  enabled?: boolean
  historyLimit?: number
}

export interface UniquenessHistoryQuery {
  appId: number
  /** Свой же ролик из истории исключаем: гейт может пересчитываться повторно. */
  excludeVideoId: number | null
  limit: number
}

export interface VideoUniquenessDependencies {
  computeFingerprint(input: VideoUniquenessInput): Promise<VideoFingerprint>
  loadHistory(query: UniquenessHistoryQuery): Promise<FingerprintHistoryEntry[]>
}

function hasSource(video: UniquenessVideoSource | null | undefined): boolean {
  return Boolean(video && (video.storageKey || video.filePath || video.fileUrl))
}

/**
 * Скачивает ролик во временный каталог и снимает хеши трёх кадров плюс обложки.
 *
 * Переиспользует `downloadVideoForPosting` — тот же путь, которым файл получает
 * постинг. Проверять надо ровно тот файл, который уедет на площадку.
 */
async function computeFingerprintWithFfmpeg(input: VideoUniquenessInput): Promise<VideoFingerprint> {
  const video = input.video
  if (!hasSource(video) || !video) {
    throw new Error('у ролика нет ни storageKey, ни filePath, ни fileUrl')
  }
  const videoId = Number(video.id) || 0

  const [{ downloadVideoForPosting, downloadVideoForPostingLegacy }, { getVideoDuration }, hasher, storage] =
    await Promise.all([
      import('../../automation/video-fetcher'),
      import('../video-tools/ffmpeg'),
      import('./video-frame-hasher'),
      import('../storage'),
    ])

  const fetched = video.storageKey
    ? await downloadVideoForPosting({ storageKey: video.storageKey, videoId })
    : await downloadVideoForPostingLegacy({ filePath: video.filePath, fileUrl: video.fileUrl, videoId })

  try {
    const known = Number(video.duration)
    const durationSec = Number.isFinite(known) && known > 0
      ? known
      : await getVideoDuration(fetched.localPath)
    const timestamps = pickFingerprintTimestamps(durationSec)
    if (timestamps.length === 0) {
      throw new Error(`не удалось определить длительность ролика (${durationSec})`)
    }
    const { frames, errors } = await hasher.hashVideoFrames(fetched.localPath, timestamps)
    if (frames.length === 0) {
      throw new Error(`ffmpeg не отдал ни одного кадра: ${errors.join('; ')}`)
    }

    // Сетка кадров — так отпечаток строят площадки. Считается одним вызовом
    // ffmpeg и не имеет права уронить проверку: три опорных кадра уже есть,
    // и отпечаток без сетки лучше, чем отсутствие отпечатка.
    const grid = await hasher
      .hashVideoFrameGrid(fetched.localPath, pickFingerprintGridTimestamps(durationSec))
      .catch(() => [] as string[])

    // Обложка считается отдельно от кадров: п.7 требует «разные первые кадры
    // И обложки», а обложка — самостоятельный ассет, не обязательно кадр ролика.
    let coverHash: string | null = null
    const coverKey = input.cover?.storageKey
    if (coverKey) {
      try {
        const driver = storage.getStorageDriver()
        const buffer = await driver.downloadToBuffer(coverKey)
        const { withTempDir } = await import('../storage/temp')
        coverHash = await withTempDir('cover-hash', async (dir) => {
          const { writeFile } = await import('node:fs/promises')
          const path = `${dir}/cover`
          await writeFile(path, buffer)
          return hasher.hashImageFile(path)
        })
      }
      catch {
        // Обложка — не повод валить весь отпечаток: кадры уже посчитаны.
        coverHash = null
      }
    }
    else if (input.cover?.filePath) {
      coverHash = await hasher.hashImageFile(input.cover.filePath).catch(() => null)
    }

    return buildVideoFingerprint({ frames, grid, coverHash, durationSec })
  }
  finally {
    await fetched.cleanup()
  }
}

/**
 * История: последние опубликованные ролики приложения и их отпечатки.
 *
 * ПОЧЕМУ окно по приложению, а не по аккаунту: один прогон публикует ролик сразу
 * в несколько аккаунтов (`FactoryPublication @@unique([runId, socialAccountId])`),
 * поэтому «лента аккаунта» уже покрыта окном приложения, а риск блокировки
 * оценивается площадкой по всему потоку продукта. Свой же videoId исключаем.
 *
 * ПОЧЕМУ отпечатки берутся из `FactoryQualityReview.checks`: менять схему БД
 * нельзя, свободного Json-поля у Video и VideoAsset нет, а эта таблица уже
 * связана с роликом и пишется этим же гейтом (см. комментарий к
 * `extractFingerprintFromChecks`).
 */
async function loadHistoryFromDatabase(query: UniquenessHistoryQuery): Promise<FingerprintHistoryEntry[]> {
  const { prisma } = await import('../prisma')

  const publications = await prisma.factoryPublication.findMany({
    where: {
      appId: query.appId,
      status: 'published',
      AND: [
        { videoId: { not: null } },
        ...(query.excludeVideoId ? [{ videoId: { not: query.excludeVideoId } }] : []),
      ],
    },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: query.limit,
    select: { videoId: true, socialAccountId: true, publishedAt: true },
  })

  const videoIds = [...new Set(publications.map(item => item.videoId).filter((id): id is number => typeof id === 'number'))]
  if (videoIds.length === 0) return []

  const reviews = await prisma.factoryQualityReview.findMany({
    where: { videoId: { in: videoIds }, stage: 'final' },
    orderBy: { updatedAt: 'desc' },
    select: { videoId: true, checks: true },
  })

  const fingerprintByVideo = new Map<number, VideoFingerprint>()
  for (const review of reviews) {
    if (typeof review.videoId !== 'number' || fingerprintByVideo.has(review.videoId)) continue
    const fingerprint = extractFingerprintFromChecks(review.checks)
    if (fingerprint) fingerprintByVideo.set(review.videoId, fingerprint)
  }

  const entries: FingerprintHistoryEntry[] = []
  const used = new Set<number>()
  for (const publication of publications) {
    const videoId = publication.videoId
    if (typeof videoId !== 'number' || used.has(videoId)) continue
    const fingerprint = fingerprintByVideo.get(videoId)
    if (!fingerprint) continue
    used.add(videoId)
    entries.push({
      videoId,
      socialAccountId: publication.socialAccountId ?? null,
      publishedAt: publication.publishedAt ? publication.publishedAt.toISOString() : null,
      fingerprint,
    })
  }
  return entries
}

export const defaultUniquenessDependencies: VideoUniquenessDependencies = {
  computeFingerprint: computeFingerprintWithFfmpeg,
  loadHistory: loadHistoryFromDatabase,
}

export async function runVideoUniquenessCheck(
  input: VideoUniquenessInput,
  deps: VideoUniquenessDependencies = defaultUniquenessDependencies,
): Promise<VideoUniquenessOutcome> {
  if (input.enabled === false) {
    return { status: 'skipped', reason: 'проверка похожести отключена в конфигурации узла' }
  }
  if (!hasSource(input.video)) {
    return { status: 'failed', error: 'у ролика нет файла для расчёта отпечатка' }
  }

  let fingerprint: VideoFingerprint
  try {
    fingerprint = await deps.computeFingerprint(input)
  }
  catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
  if (fingerprint.frames.length === 0) {
    return { status: 'failed', error: 'отпечаток не содержит ни одного кадра' }
  }

  let history: FingerprintHistoryEntry[]
  try {
    history = await deps.loadHistory({
      appId: input.appId,
      excludeVideoId: Number(input.video?.id) || null,
      limit: Math.max(1, Number(input.historyLimit) || FINGERPRINT_HISTORY_LIMIT),
    })
  }
  catch (error) {
    // История не поднялась — сравнивать не с чем. Это «не проверили», а не «чисто».
    return {
      status: 'failed',
      error: `не удалось поднять историю публикаций: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return { status: 'ok', fingerprint, comparison: findFingerprintDuplicates(fingerprint, history) }
}
