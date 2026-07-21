/**
 * GET /api/videos/:id/playback-url
 *
 * Возвращает свежий signed URL для воспроизведения финального mp4 в плеере.
 * UI запрашивает client-side (server-render не нужен — URL short-lived),
 * обновляет за 5 минут до expiresAt или по `<video @error>` (плеер сам
 * триггерит refetch при истечении).
 *
 * Если storageKey ещё не заполнен (legacy запись до миграции) — отдаём
 * legacy `/api/files/{filePath}` относительный путь, плеер прокачает его
 * через старый файл-сервинг handler. Если file_missing — playbackUrl=null
 * и UI показывает alert.
 */
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageError } from "~~/server/utils/storage/types"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "video-generator",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID видео" })
  }

  const video = await prisma.video.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      storageKey: true,
      filePath: true,
      fileUrl: true,
    },
  })

  if (!video) {
    throw createError({ statusCode: 404, message: "Видео не найдено" })
  }

  if (video.status === "file_missing") {
    return {
      videoId: video.id,
      playbackUrl: null,
      status: "file_missing" as const,
      message: "Файл недоступен. Перегенерируйте видео или пересоберите ассембли.",
    }
  }

  if (video.storageKey) {
    const driver = getStorageDriver()
    let exists: boolean
    try {
      exists = await driver.exists(video.storageKey)
    } catch (err) {
      if (err instanceof StorageError && err.code === "NOT_FOUND") {
        exists = false
      } else {
        throw err
      }
    }

    if (!exists) {
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "file_missing", storageProvider: "missing" },
      }).catch(() => {})
      return {
        videoId: video.id,
        playbackUrl: null,
        status: "file_missing" as const,
        message: "Файл пропал из storage. Перегенерируйте или восстановите из backup.",
      }
    }

    const signedUrl = await driver.getSignedDownloadUrl(video.storageKey, {
      expiresInSec: 3600,
    })
    return {
      videoId: video.id,
      playbackUrl: signedUrl,
      status: video.status,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    }
  }

  // Legacy fallback — у старых видео ещё нет storageKey.
  if (video.fileUrl) {
    return {
      videoId: video.id,
      playbackUrl: video.fileUrl,
      status: "legacy" as const,
    }
  }
  if (video.filePath) {
    return {
      videoId: video.id,
      playbackUrl: `/api/files/${encodeURIComponent(video.filePath)}`,
      status: "legacy" as const,
    }
  }

  throw createError({
    statusCode: 404,
    message: "Видео без storageKey и filePath — невозможно воспроизвести",
  })
})
