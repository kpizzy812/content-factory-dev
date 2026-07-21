/**
 * DELETE /api/admin/apps/:id/reference-images
 * Body: { url: string } — для обратной совместимости со старым UI
 * либо   { id: string }  — новый путь (AppReferenceImage.id)
 *
 * Удаляет запись AppReferenceImage, синхронно вычищает url из App.referenceImageUrls
 * и убивает файл из storage. Не зависит от того, кто создал запись.
 */
import { unlink } from "node:fs/promises"
import { basename, join } from "node:path"
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageError } from "~~/server/utils/storage/types"
import { getAppReferencesBase } from "~~/server/utils/storage-paths"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID приложения" })
  }

  const body = await readBody<{ url?: string; id?: string }>(event)
  const refId = body?.id?.trim()
  const refUrl = body?.url?.trim()
  if (!refId && !refUrl) {
    throw createError({ statusCode: 400, message: "Нужно передать `id` или `url`" })
  }

  const ref = refId
    ? await prisma.appReferenceImage.findUnique({ where: { id: refId } })
    : await prisma.appReferenceImage.findFirst({ where: { appId: id, fileUrl: refUrl } })

  // Запись могла отсутствовать (легаси-картинка только в App.referenceImageUrls без AppReferenceImage),
  // тогда просто чистим массив + файл.
  if (!ref && !refUrl) {
    throw createError({ statusCode: 404, message: "Reference картинка не найдена" })
  }
  if (ref && ref.appId !== id) {
    throw createError({ statusCode: 404, message: "Reference картинка принадлежит другому приложению" })
  }

  const targetUrl = ref?.fileUrl ?? refUrl!

  if (ref) {
    await prisma.appReferenceImage.delete({ where: { id: ref.id } })
  }

  const app = await prisma.app.findUnique({ where: { id }, select: { referenceImageUrls: true } })
  if (app) {
    const filtered = app.referenceImageUrls.filter(u => u !== targetUrl)
    if (filtered.length !== app.referenceImageUrls.length) {
      await prisma.app.update({ where: { id }, data: { referenceImageUrls: filtered } })
    }
  }

  // Удаляем файл двумя путями: через storage driver (новый storageKey)
  // и через FS (legacy app-references). Любая из веток может вернуть NOT_FOUND —
  // это допустимо, операция идемпотентна.
  if (ref?.storageKey) {
    try {
      await getStorageDriver().delete(ref.storageKey)
    } catch (err) {
      if (!(err instanceof StorageError) || err.code !== "NOT_FOUND") {
        console.warn("[reference-images] storage delete failed", err)
      }
    }
  }

  const legacyPrefix = `/api/files/app-references/${id}/`
  if (targetUrl.startsWith(legacyPrefix)) {
    const fileName = basename(targetUrl)
    const filePath = join(getAppReferencesBase(), String(id), fileName)
    try {
      await unlink(filePath)
    } catch {
      // Файл уже удалён или его не было — это допустимо.
    }
  }

  const updated = await prisma.app.findUnique({
    where: { id },
    select: { referenceImageUrls: true },
  })
  const referenceImages = await prisma.appReferenceImage.findMany({
    where: { appId: id },
    orderBy: { createdAt: "desc" },
  })

  return {
    data: {
      referenceImageUrls: updated?.referenceImageUrls ?? [],
      referenceImages,
    },
  }
})
