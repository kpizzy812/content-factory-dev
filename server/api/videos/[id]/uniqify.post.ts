/**
 * POST /api/videos/[id]/uniqify
 *
 * Track F — создание (или возврат cached) уникализированного варианта видео
 * для целевой платформы.
 *
 * Body:
 *   - platform: 'tiktok' | 'youtube' (instagram → 400, см. план Track F)
 *   - force?: boolean — игнорировать кеш и пересоздать вариант
 *
 * Response: { data: UniqueVariantResult }
 */

import { join, isAbsolute } from "node:path"
import { existsSync } from "node:fs"
import { getOrCreateUniqueVariant, type UniqifyPlatform } from "~~/server/utils/video-uniqifier"
import { getUploadsBase } from "~~/server/utils/storage-paths"

const ALLOWED_PLATFORMS: UniqifyPlatform[] = ["tiktok", "youtube"]

interface Body {
  platform?: string
  force?: boolean
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "video-generator",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID видео" })
  }

  const body = await readBody<Body>(event)
  const platform = body?.platform
  if (!platform || !ALLOWED_PLATFORMS.includes(platform as UniqifyPlatform)) {
    throw createError({
      statusCode: 400,
      message: `platform должен быть одним из: ${ALLOWED_PLATFORMS.join(", ")}`,
    })
  }

  const video = await prisma.video.findUnique({
    where: { id },
    select: { id: true, status: true, filePath: true },
  })
  if (!video) {
    throw createError({ statusCode: 404, message: "Видео не найдено" })
  }
  if (video.status !== "completed") {
    throw createError({
      statusCode: 400,
      message: `Уникализация доступна только для completed видео (текущий статус: ${video.status})`,
    })
  }
  if (!video.filePath) {
    throw createError({ statusCode: 400, message: "У видео нет filePath — нечего уникализировать" })
  }

  // video.filePath исторически записывается двумя способами: legacy uploads
  // сохраняли relative-путь ("videos/123.mp4"), а pipeline-orchestrator
  // (server/utils/video-pipeline.ts) пишет абсолютный путь от render.ts. Чтобы
  // обе ветки работали, не склеиваем со STORAGE_BASE если уже абсолютный.
  const sourceAbsPath = isAbsolute(video.filePath)
    ? video.filePath
    : join(getUploadsBase(), video.filePath)
  if (!existsSync(sourceAbsPath)) {
    throw createError({
      statusCode: 410,
      message: `Исходный файл недоступен на диске (${sourceAbsPath})`,
    })
  }

  const result = await getOrCreateUniqueVariant({
    videoId: id,
    platform: platform as UniqifyPlatform,
    sourceAbsPath,
    force: body?.force === true,
  })

  return { data: result }
})
