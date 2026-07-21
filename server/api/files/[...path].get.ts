/**
 * Раздача файлов клиенту в двух режимах.
 *
 * 1. Legacy путь (`uploads/...`, `videos/...` без префикса) — относительно
 *    UPLOADS_STORAGE_PATH через старый storage-paths helper. Это путь для
 *    БД-записей, созданных ДО миграции на GCS — backward compat ~2 недели.
 *
 * 2. Storage key (`zavodcamp/...`) — через storage driver. Для GCS
 *    отдаёт 302 на signed URL (TTL 1 час), для LocalDriver — стримит
 *    содержимое локально.
 *
 * Path traversal перекрыт двумя проверками: `assertSafeKey` (для storage
 * key) и `resolve()+startsWith()` (для legacy). Авторизация обязательна.
 */
import { createReadStream } from "node:fs"
import { access, stat } from "node:fs/promises"
import { resolve, sep, extname } from "node:path"

import { getStorageDriver } from "~~/server/utils/storage"
import {
  assertSafeKey,
  STORAGE_PATH_PREFIX,
} from "~~/server/utils/storage/prefix-guard"
import { StorageError } from "~~/server/utils/storage/types"
import { getUploadsBase } from "~~/server/utils/storage-paths"

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ass": "text/plain",
  ".srt": "text/plain",
  ".vtt": "text/vtt",
}

const MUTABLE_EXTS = new Set([".mp4", ".mp3", ".webm", ".wav"])

function isStorageKey(input: string): boolean {
  return input.startsWith(STORAGE_PATH_PREFIX)
}

/**
 * Толерантная нормализация пути из router param.
 *
 * UI местами строит URL как `/api/files/${asset.fileUrl}` где `fileUrl`
 * после миграции на GCS уже содержит `/api/files/...` (вывод
 * `storageKeyToLegacyUrl`). Получается двойной префикс
 * `/api/files//api/files/<key>` — h3 catch-all отдаёт нам остаток после
 * первого `/api/files/`, который снова начинается с `/api/files/` или
 * `/`. Срезаем лишние префиксы пока не останется чистый storage key
 * (либо legacy относительный путь).
 *
 * Дополнительно: если path encoded целиком (`%2F` вместо `/`), Nuxt
 * передаст один сегмент со %2F. Первый decode восстанавливает слеши.
 * Если после первого decode остались %2F (двойное encoding на стороне
 * UI), пробуем второй decode — безопасно, ничего не сломает если в
 * пути есть валидные символы вроде `%20` для пробелов.
 */
function normalizePathParam(raw: string): string {
  let s = raw

  // Первый decode — расшифровать %2F → /, %20 → пробел и т.п.
  try {
    s = decodeURIComponent(s)
  } catch {
    // оставим как есть — дальше отдадим 404 / 400
  }

  // Срезаем все ведущие слеши и любые дублирующиеся `api/files/` префиксы.
  // Цикл — на случай тройного префикса, дёшево и предсказуемо.
  let prevLength = -1
  while (s.length !== prevLength) {
    prevLength = s.length
    while (s.startsWith("/")) s = s.slice(1)
    if (s.startsWith("api/files/")) s = s.slice("api/files/".length)
  }

  // Если после первого decode остался %2F — это значит UI сделал двойной
  // encodeURIComponent. Раскодируем ещё раз, иначе ключ не попадёт в
  // storage-ветку (не начинается с `zavodcamp/`).
  if (s.includes("%2F") || s.includes("%2f") || s.includes("%5C")) {
    try {
      s = decodeURIComponent(s)
    } catch {
      // не валидно — оставляем, дальше 400/404
    }
  }

  return s
}

export default defineEventHandler(async (event) => {
  await getAuthContext(event)

  const pathParam = getRouterParam(event, "path")
  if (!pathParam) {
    throw createError({ statusCode: 400, message: "Путь к файлу не указан" })
  }

  const normalized = normalizePathParam(pathParam)
  if (!normalized) {
    throw createError({ statusCode: 400, message: "Путь к файлу не указан" })
  }

  if (isStorageKey(normalized)) {
    try {
      assertSafeKey(normalized, "/api/files (storage key)")
    } catch (err) {
      const msg = err instanceof StorageError ? err.message : "Недопустимый ключ"
      throw createError({ statusCode: 400, message: msg })
    }

    const driver = getStorageDriver()

    if (driver.providerName === "gcs") {
      const exists = await driver.exists(normalized)
      if (!exists) {
        throw createError({ statusCode: 404, message: "Файл не найден" })
      }
      const signed = await driver.getSignedDownloadUrl(normalized, {
        expiresInSec: 3600,
      })
      return sendRedirect(event, signed, 302)
    }

    // Local / mock — стримим напрямую (для dev и tests).
    let buffer: Buffer
    try {
      buffer = await driver.downloadToBuffer(normalized)
    } catch (err) {
      if (err instanceof StorageError && err.code === "NOT_FOUND") {
        throw createError({ statusCode: 404, message: "Файл не найден" })
      }
      throw err
    }
    const ext = extname(normalized).toLowerCase()
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
    setResponseHeader(event, "Content-Type", contentType)
    setResponseHeader(event, "Content-Length", buffer.length)
    setResponseHeader(
      event,
      "Cache-Control",
      MUTABLE_EXTS.has(ext) ? "private, no-cache" : "private, max-age=3600",
    )
    return buffer
  }

  // === Legacy path (без префикса) — относительно UPLOADS_STORAGE_PATH ===
  const storageBase = getUploadsBase()
  const filePath = resolve(storageBase, normalized)
  if (!filePath.startsWith(storageBase + sep) && filePath !== storageBase) {
    throw createError({ statusCode: 400, message: "Недопустимый путь к файлу" })
  }

  let fileStat
  try {
    await access(filePath)
    fileStat = await stat(filePath)
  } catch {
    throw createError({ statusCode: 404, message: "Файл не найден" })
  }

  const ext = extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
  const etag = `"${fileStat.mtimeMs.toString(36)}-${fileStat.size.toString(36)}"`

  const ifNoneMatch = getHeader(event, "if-none-match")
  if (ifNoneMatch === etag) {
    setResponseStatus(event, 304)
    return ""
  }

  setResponseHeader(event, "Content-Type", contentType)
  setResponseHeader(event, "ETag", etag)
  setResponseHeader(
    event,
    "Cache-Control",
    MUTABLE_EXTS.has(ext) ? "private, no-cache" : "private, max-age=3600",
  )
  return sendStream(event, createReadStream(filePath))
})
