/**
 * POST /api/google-drive/files/[id]/download — скачать файл в storage.
 *
 * Permissions: canRunAgent (модуль trendwatcher).
 * Rate-limit: per-user 30/60s.
 *
 * Идемпотентен: повторный вызов на уже скачанный файл (syncStatus=downloaded
 * + файл существует на диске) возвращает текущие данные без перекачивания.
 */
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { extname, resolve } from "node:path"
import { classifyDriveError, createDriveClient } from "~~/server/utils/google-drive/client"
import { loadDriveCredential } from "~~/server/utils/google-drive/credential"
import { downloadDriveFile } from "~~/server/utils/google-drive/download"
import { checkUserRateLimit } from "~~/server/utils/google-drive/rate-limit"

const DRIVE_IMPORTS_DIR = resolve(process.cwd(), "storage/uploads/drive-imports")

const MIME_EXT_MAP: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
}

function slug(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50) || "file"
}

function pickExtension(name: string, mimeType: string): string {
  const fromName = extname(name).replace(/^\./, "").toLowerCase()
  if (fromName && fromName.length <= 5) return fromName
  const fromMime = MIME_EXT_MAP[mimeType.toLowerCase()]
  if (fromMime) return fromMime
  return "bin"
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "trendwatcher",
  })

  const idRaw = getRouterParam(event, "id")
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID файла" })
  }

  const file = await prisma.driveFile.findUnique({ where: { id } })
  if (!file) {
    throw createError({ statusCode: 404, message: "DriveFile не найден" })
  }
  if (file.userId !== user.id) {
    throw createError({ statusCode: 403, message: "Нет доступа к этому файлу" })
  }

  // Idempotency: уже скачано и файл существует — возвращаем без перекачивания
  if (file.syncStatus === "downloaded" && file.localPath && existsSync(file.localPath)) {
    return {
      data: {
        id: file.id,
        localPath: file.localPath,
        sizeBytes:
          file.sizeBytes !== null && file.sizeBytes !== undefined
            ? file.sizeBytes.toString()
            : null,
        syncStatus: file.syncStatus,
      },
    }
  }

  const rate = checkUserRateLimit(user.id)
  if (!rate.ok) {
    setHeader(event, "Retry-After", String(rate.retryAfterSec ?? 60))
    throw createError({
      statusCode: 429,
      message: `Слишком много запросов. Повторите через ${rate.retryAfterSec ?? 60} сек.`,
    })
  }

  await prisma.driveFile.update({
    where: { id: file.id },
    data: { syncStatus: "downloading", syncError: null },
  })

  let loaded
  try {
    loaded = await loadDriveCredential(file.credentialId, user.id)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Неизвестная ошибка"
    await prisma.driveFile
      .update({
        where: { id: file.id },
        data: { syncStatus: "failed", syncError: message },
      })
      .catch(() => {})
    throw err
  }

  const client = createDriveClient(loaded.accessToken)

  const ext = pickExtension(file.name, file.mimeType)
  await mkdir(DRIVE_IMPORTS_DIR, { recursive: true })
  const localPath = resolve(DRIVE_IMPORTS_DIR, `${file.driveFileId}_${slug(file.name)}.${ext}`)

  try {
    const result = await downloadDriveFile(client, {
      driveFileId: file.driveFileId,
      localPath,
      accessToken: loaded.accessToken,
    })
    const updated = await prisma.driveFile.update({
      where: { id: file.id },
      data: {
        syncStatus: "downloaded",
        localPath: result.localPath,
        sizeBytes: file.sizeBytes ?? result.sizeBytes,
        lastSyncedAt: new Date(),
        syncError: null,
      },
    })
    return {
      data: {
        id: updated.id,
        localPath: updated.localPath,
        sizeBytes:
          updated.sizeBytes !== null && updated.sizeBytes !== undefined
            ? updated.sizeBytes.toString()
            : null,
        syncStatus: updated.syncStatus,
      },
    }
  } catch (err: unknown) {
    const classified = classifyDriveError(err)
    const message = err instanceof Error ? err.message : classified.message
    await prisma.driveFile
      .update({
        where: { id: file.id },
        data: { syncStatus: "failed", syncError: message.slice(0, 500) },
      })
      .catch(() => {})
    if (typeof err === "object" && err !== null && "statusCode" in err) {
      throw err
    }
    throw createError({
      statusCode: classified.statusCode,
      message: `Drive download: ${classified.message}`,
      data: { category: classified.category },
    })
  }
})
