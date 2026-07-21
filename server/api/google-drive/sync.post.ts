/**
 * POST /api/google-drive/sync — запустить sync конкретной папки.
 *
 * Permissions: canRunAgent (модуль trendwatcher).
 * Body: { credentialId: number; folderId: string; onlyVideos?: boolean }
 * Rate-limit: per-user 30/60s.
 *
 * Создаёт/обновляет DriveFile записи. Не скачивает файлы.
 */
import { checkUserRateLimit } from "~~/server/utils/google-drive/rate-limit"
import { syncDriveFiles } from "~~/server/utils/google-drive/sync"

const FOLDER_ID_PATTERN = /^[\w-]{10,}$/

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "trendwatcher",
  })

  const body = await readBody<{
    credentialId?: number
    folderId?: string
    onlyVideos?: boolean
  }>(event)

  const credentialId = Number(body?.credentialId ?? Number.NaN)
  if (!Number.isFinite(credentialId) || credentialId <= 0) {
    throw createError({ statusCode: 400, message: "Поле credentialId обязательно" })
  }

  const folderId = typeof body?.folderId === "string" ? body.folderId.trim() : ""
  if (!FOLDER_ID_PATTERN.test(folderId)) {
    throw createError({
      statusCode: 400,
      message:
        "Невалидный folderId. Укажите ID папки Google Drive (из URL: drive.google.com/drive/folders/<ID>)",
    })
  }

  const rate = checkUserRateLimit(user.id)
  if (!rate.ok) {
    setHeader(event, "Retry-After", String(rate.retryAfterSec ?? 60))
    throw createError({
      statusCode: 429,
      message: `Слишком много запросов. Повторите через ${rate.retryAfterSec ?? 60} сек.`,
    })
  }

  const result = await syncDriveFiles({
    credentialId,
    userId: user.id,
    folderId,
    onlyVideos: body?.onlyVideos ?? true,
  })

  return { data: result }
})
