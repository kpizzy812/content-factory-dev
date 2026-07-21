/**
 * GET /api/videos/:id/storage-status
 *
 * Лёгкая проверка наличия физических файлов на диске для конкретного видео.
 * Вызывается UI на странице `/videos/[id]` когда видео-плеер получает 404 при
 * загрузке mp4 — нужно подсказать оператору что именно отвалилось и можно ли
 * пересобрать ассембли без повторной (платной) генерации клипов/картинок.
 *
 * Возвращает per-asset флаги наличия + сводные счётчики. `canReassemble = true`
 * означает, что все clip-ассеты на диске — `rerender-assembly` соберёт mp4 без
 * новых вызовов fal/Anthropic. Иначе нужен полный rerunVideoStep('image_generation')
 * или 'clip_generation' — будет повторно потрачено.
 */
import { existsSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import { getStorageDriver } from "~~/server/utils/storage"
import { getUploadsBase } from "~~/server/utils/storage-paths"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, "id"))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID видео" })
  }

  const video = await prisma.video.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      fileUrl: true,
      filePath: true,
      storageKey: true,
      assets: {
        select: {
          id: true,
          type: true,
          order: true,
          filePath: true,
          fileUrl: true,
          storageKey: true,
        },
        orderBy: { order: "asc" },
      },
    },
  })

  if (!video) {
    throw createError({ statusCode: 404, message: "Видео не найдено" })
  }

  const storageBase = getUploadsBase()
  const driver = getStorageDriver()

  // Параллельно проверяем все storageKey'и через driver (одна сетевая
  // ходка на каждый — в GCS это HEAD). filePath/fileUrl чекаем локально.
  const storageKeys = [
    video.storageKey,
    ...video.assets.map((a) => a.storageKey),
  ].filter((k): k is string => Boolean(k))
  const storagePresence = new Map<string, boolean>()
  await Promise.all(
    storageKeys.map(async (key) => {
      try {
        storagePresence.set(key, await driver.exists(key))
      } catch {
        storagePresence.set(key, false)
      }
    }),
  )

  const checkAsset = (a: { storageKey: string | null; filePath: string | null; fileUrl: string | null }) =>
    (a.storageKey && storagePresence.get(a.storageKey)) ||
    checkLocalFs(a.filePath, a.fileUrl, storageBase)

  const videoOnDisk = checkAsset({
    storageKey: video.storageKey,
    filePath: video.filePath,
    fileUrl: video.fileUrl,
  })

  const clips = video.assets.filter(a => a.type === "clip")
  const images = video.assets.filter(a => a.type === "image")
  const music = video.assets.filter(a => a.type === "music")

  const missingClips = clips.filter((a) => !checkAsset(a))
  const missingImages = images.filter((a) => !checkAsset(a))
  const missingMusic = music.filter((a) => !checkAsset(a))

  // canReassemble: assembly шаг нуждается в клипах + (опционально) музыке.
  // Картинки нужны были только для clip_generation — без них ассембли соберётся.
  const canReassemble =
    video.status === "completed" &&
    clips.length > 0 &&
    missingClips.length === 0

  return {
    data: {
      id: video.id,
      status: video.status,
      videoOnDisk,
      videoFileUrl: video.fileUrl,
      clips: {
        total: clips.length,
        onDisk: clips.length - missingClips.length,
        missing: missingClips.map(a => ({ id: a.id, order: a.order })),
      },
      images: {
        total: images.length,
        onDisk: images.length - missingImages.length,
        missing: missingImages.map(a => ({ id: a.id, order: a.order })),
      },
      music: {
        total: music.length,
        onDisk: music.length - missingMusic.length,
      },
      canReassemble,
      // Подсказка для UI какую кнопку показать.
      recoveryHint: deriveHint({
        videoOnDisk,
        canReassemble,
        clipsMissing: missingClips.length,
        imagesMissing: missingImages.length,
        clipsTotal: clips.length,
      }),
    },
  }
})

function checkLocalFs(
  filePath: string | null,
  fileUrl: string | null,
  storageBase: string,
): boolean {
  if (filePath) {
    if (isAbsolute(filePath)) {
      return existsSync(filePath)
    }
    return existsSync(join(storageBase, filePath))
  }
  if (fileUrl) {
    return existsSync(join(storageBase, fileUrl))
  }
  return false
}

type Hint =
  | "all_present"
  | "video_missing_can_reassemble"
  | "video_missing_needs_full_regen"
  | "assets_partial"

function deriveHint(opts: {
  videoOnDisk: boolean
  canReassemble: boolean
  clipsMissing: number
  imagesMissing: number
  clipsTotal: number
}): Hint {
  if (opts.videoOnDisk && opts.clipsMissing === 0) return "all_present"
  if (!opts.videoOnDisk && opts.canReassemble) return "video_missing_can_reassemble"
  if (!opts.videoOnDisk && opts.clipsTotal > 0 && opts.clipsMissing > 0) {
    return "video_missing_needs_full_regen"
  }
  return "assets_partial"
}
