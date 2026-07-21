/**
 * POST /api/admin/apps/:id/reference-images
 * Загрузка одной или нескольких reference-картинок для приложения.
 * Принимает multipart/form-data (поле `files`, MIME image/*), сохраняет на диск
 * в storage/uploads/app-references/{appId}/{sha1}.{ext} и создаёт AppReferenceImage запись.
 * App.referenceImageUrls обновляется параллельно (legacy fallback для генераторов сценариев).
 *
 * Сразу после save запускает fire-and-forget AI-анализ скриншота через screen-tagger-agent
 * (vision Anthropic). UI получает запись со status=pending и опрашивает aiAnalyzedAt.
 */
import { createHash } from "node:crypto"
import { scheduleScreenAnalysis } from "~~/server/utils/agents/screen-tagger-agent"
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { storageKeyToLegacyUrl } from "~~/server/utils/storage/download-to-storage"
const MAX_FILE_BYTES = 20 * 1024 * 1024 // 20 MB
const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")
  const session = await getUserSession(event)
  const uploadedById = (session?.user as { id?: number } | undefined)?.id ?? null

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID приложения" })
  }

  const app = await prisma.app.findUnique({ where: { id }, select: { id: true, referenceImageUrls: true } })
  if (!app) {
    throw createError({ statusCode: 404, message: "Приложение не найдено" })
  }

  const parts = await readMultipartFormData(event)
  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, message: "Файлы не получены" })
  }

  const fileParts = parts.filter(p => p.name === "files" && p.filename && p.data)
  if (fileParts.length === 0) {
    throw createError({ statusCode: 400, message: "Поле `files` пустое" })
  }

  const storage = getStorageDriver()
  const currentUrls = new Set(app.referenceImageUrls)
  const addedUrls: string[] = []
  const createdRefIds: string[] = []

  for (const part of fileParts) {
    const mime = (part.type || "").toLowerCase()
    const ext = ALLOWED_MIME[mime]
    if (!ext) {
      throw createError({ statusCode: 415, message: `Неподдерживаемый формат: ${mime || "unknown"}` })
    }
    if (part.data.length > MAX_FILE_BYTES) {
      throw createError({ statusCode: 413, message: `Файл больше ${MAX_FILE_BYTES / (1024 * 1024)} MB` })
    }

    const sha1 = createHash("sha1").update(part.data).digest("hex").slice(0, 16)
    const storageKey = StorageKeys.appReferenceImage(id, sha1, ext)
    const url = storageKeyToLegacyUrl(storageKey)

    // upsert AppReferenceImage по (appId, sha1) — дедуп на уровне БД
    const existing = await prisma.appReferenceImage.findUnique({
      where: { appId_sha1: { appId: id, sha1 } },
    })

    if (!existing) {
      // Заливаем в storage. Driver безразличен — local/gcs/mock.
      // Перезаписывает существующий объект — идемпотентно для повторных загрузок
      // с тем же sha1 (например, после удаления БД-row).
      await storage.uploadBuffer(storageKey, part.data, { contentType: mime })

      const created = await prisma.appReferenceImage.create({
        data: {
          appId: id,
          fileUrl: url,
          sha1,
          mimeType: mime,
          bytes: part.data.length,
          storageKey,
          storageProvider: storage.providerName,
          uploadedById,
        },
      })

      createdRefIds.push(created.id)
      if (!currentUrls.has(url)) {
        currentUrls.add(url)
        addedUrls.push(url)
      }
    } else if (!currentUrls.has(url)) {
      // Картинка уже была в БД, но url не в App.referenceImageUrls — синхронизируем
      currentUrls.add(url)
      addedUrls.push(url)
    }
  }

  if (addedUrls.length > 0) {
    await prisma.app.update({
      where: { id },
      data: { referenceImageUrls: Array.from(currentUrls) },
    })
  }

  // Fire-and-forget AI-анализ для всех новых записей. Параллельно — каждая картинка
  // независимый Anthropic vision call.
  for (const refId of createdRefIds) {
    scheduleScreenAnalysis(refId)
  }

  // Возвращаем актуальный список AppReferenceImage (с aiAnalyzedAt=null для свежих —
  // UI покажет spinner и опросит позже).
  const referenceImages = await prisma.appReferenceImage.findMany({
    where: { appId: id },
    orderBy: { createdAt: "desc" },
  })

  return {
    data: {
      added: addedUrls,
      referenceImageUrls: Array.from(currentUrls),
      referenceImages,
    },
  }
})
