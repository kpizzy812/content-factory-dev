/**
 * Доступ к записям опорных кадров и доставка их файлов на диск.
 *
 * Слой намеренно тонкий: маршрутизация по источникам, выбор способа доставки и
 * разбор mime живут в `reference-frame.ts` и проверяются без БД. Здесь только
 * запросы Prisma и запись файла.
 */

import { join } from "node:path"
import { prisma } from "../prisma"
import { downloadFile } from "../video-helpers"
import { resolveAppReferenceLocalPath } from "../agents/screen-tagger-agent"
import { getStorageDriver } from "../storage"
import {
  planReferenceFrameDelivery,
  referenceFrameKey,
  type ReferenceFrameDeps,
  type ResolvedReferenceFrame,
} from "./reference-frame"

export function createReferenceFrameDeps(): ReferenceFrameDeps {
  return {
    async findAppReferences(ids) {
      return prisma.appReferenceImage.findMany({
        where: { id: { in: ids } },
        select: { id: true, appId: true, fileUrl: true, mimeType: true, storageKey: true },
      })
    },
    async findCharacterReferences(ids) {
      return prisma.characterReferenceImage.findMany({
        where: { id: { in: ids } },
        select: { id: true, fileUrl: true, mimeType: true, storageKey: true },
      })
    },
    async findSceneReferences(ids) {
      return prisma.sceneReferenceImage.findMany({
        where: { id: { in: ids } },
        select: { id: true, fileUrl: true, mimeType: true, storageKey: true },
      })
    },
  }
}

/** Расширение для локальной копии кадра: модель различает форматы по имени файла. */
function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg"
  if (mimeType === "image/webp") return ".webp"
  if (mimeType === "image/gif") return ".gif"
  return ".png"
}

/**
 * Кладёт файл опорного кадра в рабочий каталог и возвращает путь. Null означает
 * «доставить нечем» — вызывающий шаг обязан откатиться на text-to-video, а не
 * уходить в платную задачу с пустым входом.
 */
export async function materializeReferenceFrame(
  frame: ResolvedReferenceFrame,
  workDir: string,
): Promise<string | null> {
  const delivery = planReferenceFrameDelivery(frame)
  if (!delivery) return null

  if (delivery.kind === "legacy_app_file") {
    return resolveAppReferenceLocalPath(delivery.appId, delivery.fileUrl)
  }

  const safeName = referenceFrameKey(frame).replace(/[^a-zA-Z0-9_-]/g, "_")
  const localPath = join(workDir, `refframe_${safeName}${extensionFor(frame.mimeType)}`)

  if (delivery.kind === "storage") {
    await getStorageDriver().downloadToFile(delivery.storageKey, localPath)
  } else {
    await downloadFile(delivery.url, localPath)
  }

  return localPath
}
