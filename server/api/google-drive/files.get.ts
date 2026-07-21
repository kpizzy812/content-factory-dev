/**
 * GET /api/google-drive/files — список DriveFile из БД (с фильтрами).
 *
 * Permissions: canRead (модуль trendwatcher).
 * Query: credentialId?, syncStatus?, hasGeneratedCaption?, videoOnly?, cursor?, limit? (default 50, max 100)
 *
 * Только записи userId === user.id.
 * BigInt sizeBytes сериализуется как number (если safe) или string.
 */
import type { DriveFile, DriveSyncStatus, Prisma } from "@prisma/client"

const VALID_STATUSES: DriveSyncStatus[] = [
  "detected",
  "downloading",
  "downloaded",
  "imported_to_video",
  "failed",
]

function parseBoolQuery(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (value === "true" || value === "1") return true
    if (value === "false" || value === "0") return false
  }
  return undefined
}

function parseNumberQuery(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

interface SerializedDriveFile {
  id: number
  userId: number
  credentialId: number
  driveFileId: string
  name: string
  mimeType: string
  sizeBytes: number | string | null
  driveCreatedAt: string | null
  driveModifiedAt: string | null
  driveUrl: string | null
  thumbnailUrl: string | null
  videoId: number | null
  syncStatus: DriveSyncStatus
  localPath: string | null
  lastSyncedAt: string | null
  syncError: string | null
  hasGeneratedCaption: boolean
  createdAt: string
}

export function serializeDriveFile(file: DriveFile): SerializedDriveFile {
  let sizeBytes: number | string | null = null
  if (file.sizeBytes !== null && file.sizeBytes !== undefined) {
    const asString = file.sizeBytes.toString()
    const asNumber = Number(asString)
    sizeBytes =
      Number.isFinite(asNumber) && asNumber <= Number.MAX_SAFE_INTEGER ? asNumber : asString
  }
  return {
    id: file.id,
    userId: file.userId,
    credentialId: file.credentialId,
    driveFileId: file.driveFileId,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes,
    driveCreatedAt: file.driveCreatedAt?.toISOString() ?? null,
    driveModifiedAt: file.driveModifiedAt?.toISOString() ?? null,
    driveUrl: file.driveUrl,
    thumbnailUrl: file.thumbnailUrl,
    videoId: file.videoId,
    syncStatus: file.syncStatus,
    localPath: file.localPath,
    lastSyncedAt: file.lastSyncedAt?.toISOString() ?? null,
    syncError: file.syncError,
    hasGeneratedCaption: file.hasGeneratedCaption,
    createdAt: file.createdAt.toISOString(),
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "trendwatcher",
  })

  const query = getQuery(event)

  const credentialId = parseNumberQuery(query.credentialId)
  const syncStatusRaw = typeof query.syncStatus === "string" ? query.syncStatus : undefined
  const syncStatus =
    syncStatusRaw && VALID_STATUSES.includes(syncStatusRaw as DriveSyncStatus)
      ? (syncStatusRaw as DriveSyncStatus)
      : undefined
  const hasGeneratedCaption = parseBoolQuery(query.hasGeneratedCaption)
  const videoOnly = parseBoolQuery(query.videoOnly)
  const cursor = parseNumberQuery(query.cursor)
  const limitRaw = parseNumberQuery(query.limit)
  const limit = Math.min(Math.max(1, limitRaw ?? 50), 100)

  const where: Prisma.DriveFileWhereInput = { userId: user.id }
  if (credentialId !== undefined) where.credentialId = credentialId
  if (syncStatus !== undefined) where.syncStatus = syncStatus
  if (hasGeneratedCaption !== undefined) where.hasGeneratedCaption = hasGeneratedCaption
  if (videoOnly === true) where.mimeType = { startsWith: "video/" }

  const total = await prisma.driveFile.count({ where })

  const items = await prisma.driveFile.findMany({
    where,
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    orderBy: { id: "desc" },
  })

  let nextCursor: number | undefined
  let pageItems = items
  if (items.length > limit) {
    pageItems = items.slice(0, limit)
    const last = pageItems[pageItems.length - 1]
    nextCursor = last?.id
  }

  return {
    data: pageItems.map((f) => serializeDriveFile(f)),
    meta: { nextCursor, total },
  }
})
