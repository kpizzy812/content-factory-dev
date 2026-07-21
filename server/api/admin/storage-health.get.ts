/**
 * GET /api/admin/storage-health
 *
 * Сверяет последние completed-видео в БД с реальными файлами на диске и
 * возвращает список тех, у кого `Video.fileUrl` указан но файл `videos/{id}.mp4`
 * физически отсутствует. Отдельно перебирает Image-ассеты этих видео — там та же
 * история. По каждому missing видео считает, можно ли пересобрать только assembly
 * (если все клипы на диске) или нужен полный re-generate.
 *
 * Используется UI на `/admin/storage-health` (планируется), а на странице
 * `/videos/[id]` — точечно через 404-fallback (там запрос идёт не сюда, а напрямую
 * на /api/files и при провале UI зовёт `/api/videos/[id]/storage-status`).
 *
 * Параметр `limit` ограничивает выборку (default 100, max 500).
 */
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { describeStorageDriver, getStorageDriver } from "~~/server/utils/storage"
import { getUploadsBase } from "~~/server/utils/storage-paths"

interface MissingVideoEntry {
  id: number
  scenarioId: number | null
  title: string | null
  status: string
  fileUrl: string | null
  completedAt: string | null
  missingVideoFile: boolean
  missingImageAssets: number
  totalImageAssets: number
  missingClipAssets: number
  totalClipAssets: number
  canReassemble: boolean
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const query = getQuery(event)
  const rawLimit = Number(query.limit ?? 100)
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, rawLimit)) : 100

  const storageBase = getUploadsBase()

  const videos = await prisma.video.findMany({
    where: { status: "completed", fileUrl: { not: null } },
    select: {
      id: true,
      scenarioId: true,
      status: true,
      fileUrl: true,
      filePath: true,
      storageKey: true,
      storageProvider: true,
      finishedAt: true,
      scenario: {
        select: {
          variants: {
            select: { title: true, variantIndex: true },
            orderBy: { variantIndex: "asc" },
            take: 1,
          },
        },
      },
      assets: {
        select: {
          id: true,
          type: true,
          filePath: true,
          fileUrl: true,
          storageKey: true,
        },
      },
    },
    orderBy: { id: "desc" },
    take: limit,
  })

  // Параллельно проверяем все storageKey'и (1 HEAD-запрос в GCS на ключ).
  const driver = getStorageDriver()
  const allStorageKeys = new Set<string>()
  for (const v of videos) {
    if (v.storageKey) allStorageKeys.add(v.storageKey)
    for (const a of v.assets) if (a.storageKey) allStorageKeys.add(a.storageKey)
  }
  const storagePresence = new Map<string, boolean>()
  await Promise.all(
    Array.from(allStorageKeys).map(async (key) => {
      try {
        storagePresence.set(key, await driver.exists(key))
      } catch {
        storagePresence.set(key, false)
      }
    }),
  )

  const missing: MissingVideoEntry[] = []
  let totalCompleted = 0
  let totalVideoFilesOnDisk = 0
  let totalImageAssetsExpected = 0
  let totalImageAssetsOnDisk = 0
  let totalClipAssetsExpected = 0
  let totalClipAssetsOnDisk = 0

  const checkPresence = (asset: { storageKey: string | null; filePath: string | null; fileUrl: string | null }) => {
    if (asset.storageKey && storagePresence.get(asset.storageKey)) return true
    return assetExists(asset, storageBase)
  }

  for (const video of videos) {
    totalCompleted += 1

    const videoExists = checkPresence(video)
    if (videoExists) totalVideoFilesOnDisk += 1

    const imageAssets = video.assets.filter(a => a.type === "image")
    const clipAssets = video.assets.filter(a => a.type === "clip")
    totalImageAssetsExpected += imageAssets.length
    totalClipAssetsExpected += clipAssets.length

    const missingImageCount = imageAssets.filter(a => !checkPresence(a)).length
    const missingClipCount = clipAssets.filter(a => !checkPresence(a)).length

    totalImageAssetsOnDisk += imageAssets.length - missingImageCount
    totalClipAssetsOnDisk += clipAssets.length - missingClipCount

    const hasAnyProblem = !videoExists || missingImageCount > 0 || missingClipCount > 0
    if (!hasAnyProblem) continue

    missing.push({
      id: video.id,
      scenarioId: video.scenarioId,
      title: video.scenario?.variants[0]?.title ?? null,
      status: video.status,
      fileUrl: video.fileUrl,
      completedAt: video.finishedAt?.toISOString() ?? null,
      missingVideoFile: !videoExists,
      missingImageAssets: missingImageCount,
      totalImageAssets: imageAssets.length,
      missingClipAssets: missingClipCount,
      totalClipAssets: clipAssets.length,
      canReassemble: missingClipCount === 0 && clipAssets.length > 0,
    })
  }

  let freeSpaceGB: number | null = null
  let baseExists = false
  try {
    const s = statSync(storageBase)
    baseExists = s.isDirectory()
  } catch {
    baseExists = false
  }
  try {
    const { statfs } = await import("node:fs/promises")
    const fsStats = await statfs(storageBase)
    freeSpaceGB = Math.round((fsStats.bsize * fsStats.bavail) / 1_000_000_000 * 100) / 100
  } catch {
    freeSpaceGB = null
  }

  return {
    data: {
      storageBase,
      baseExists,
      freeSpaceGB,
      driver: describeStorageDriver(),
      checkedVideos: totalCompleted,
      videoFilesOnDisk: totalVideoFilesOnDisk,
      videoFilesMissing: totalCompleted - totalVideoFilesOnDisk,
      imageAssetsExpected: totalImageAssetsExpected,
      imageAssetsOnDisk: totalImageAssetsOnDisk,
      clipAssetsExpected: totalClipAssetsExpected,
      clipAssetsOnDisk: totalClipAssetsOnDisk,
      missing,
    },
  }
})

function assetExists(asset: { filePath: string | null; fileUrl: string | null }, storageBase: string): boolean {
  if (asset.filePath && asset.filePath.startsWith("/")) {
    return existsSync(asset.filePath)
  }
  if (asset.fileUrl) {
    return existsSync(join(storageBase, asset.fileUrl))
  }
  if (asset.filePath) {
    return existsSync(join(storageBase, asset.filePath))
  }
  return false
}
