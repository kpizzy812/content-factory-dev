/**
 * GET /api/posting/screenshot-url?key=zavodcamp/posting-errors/...
 *
 * Возвращает signed URL на короткое время (10 мин) для diagnostic файла
 * posting'а. Поддерживает PNG (screenshot), HTML (DOM dump), JSON (metadata).
 * Content-type определяется по extension в key.
 *
 * Permissions: requireScopedAccess({ permissions: ["canRead"], moduleSlug: "social-upload" })
 * (canAdmin bypass — стандартное поведение).
 *
 * Validation:
 *   - key обязателен
 *   - key должен начинаться с "zavodcamp/posting-errors/" (защита от чтения произвольных файлов)
 *   - extension должен быть в whitelist (.png|.html|.json) — иначе 415
 */

import { getStorageDriver } from "~~/server/utils/storage"

const SCREENSHOT_PREFIX = "zavodcamp/posting-errors/"
const URL_TTL_SEC = 600

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const query = getQuery(event)
  const key = String(query.key ?? "").trim()

  if (!key) {
    throw createError({ statusCode: 400, message: "key обязателен" })
  }

  if (!key.startsWith(SCREENSHOT_PREFIX)) {
    throw createError({
      statusCode: 403,
      message: `Этот endpoint выдаёт URL только для ${SCREENSHOT_PREFIX} префикса.`,
    })
  }

  if (key.includes("..") || key.includes("//")) {
    throw createError({ statusCode: 400, message: "Невалидный key" })
  }

  const ext = key.slice(key.lastIndexOf("."))
  const contentType = CONTENT_TYPE_BY_EXT[ext]
  if (!contentType) {
    throw createError({
      statusCode: 415,
      message: `Неподдерживаемое расширение '${ext}'. Разрешено: ${Object.keys(CONTENT_TYPE_BY_EXT).join(", ")}`,
    })
  }

  const driver = getStorageDriver()
  const exists = await driver.exists(key).catch(() => false)
  if (!exists) {
    throw createError({ statusCode: 404, message: "Файл не найден" })
  }

  const url = await driver.getSignedDownloadUrl(key, {
    expiresInSec: URL_TTL_SEC,
    responseContentType: contentType,
  })

  return { data: { url, expiresInSec: URL_TTL_SEC, contentType } }
})
