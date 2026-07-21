/**
 * Drive sync — обнаруживает файлы в указанной папке и создаёт/обновляет DriveFile записи.
 *
 * НЕ скачивает файлы. Скачивание — отдельный endpoint (download.post.ts).
 * Дедупликация через unique constraint (credentialId, driveFileId).
 *
 * refreshDriveFileMetadata — для scheduler tick: обновляет metadata уже известного
 * DriveFile через GET /drive/v3/files/{id} (без обращения к папке целиком).
 */
import { logAgent } from "../agent-logger"
import { prisma } from "../prisma"
import { createDriveClient, type DriveClient } from "./client"
import { loadDriveCredential } from "./credential"

const MAX_PAGES = 5
const DEFAULT_PAGE_SIZE = 100
const FOLDER_ID_PATTERN = /^[\w-]{10,}$/

export interface SyncOptions {
  credentialId: number
  userId: number
  folderId: string
  onlyVideos?: boolean
  pageSize?: number
}

export interface SyncResultError {
  driveFileId: string
  message: string
}

export interface SyncResult {
  scanned: number
  created: number
  updated: number
  skipped: number
  errors: SyncResultError[]
}

interface DriveFileApiItem {
  id: string
  name: string
  mimeType: string
  size?: string
  createdTime?: string
  modifiedTime?: string
  webViewLink?: string
  thumbnailLink?: string
}

interface DriveFilesApiResponse {
  files?: DriveFileApiItem[]
  nextPageToken?: string
}

function buildFilesQuery(folderId: string, onlyVideos: boolean): string {
  const clauses = [`'${folderId}' in parents`, "trashed=false"]
  if (onlyVideos) clauses.push("mimeType contains 'video/'")
  return clauses.join(" and ")
}

function safeBigInt(raw: string | undefined | null): bigint | null {
  if (typeof raw !== "string" || raw.length === 0) return null
  try {
    return BigInt(raw)
  } catch {
    return null
  }
}

function safeDate(raw: string | undefined | null): Date | null {
  if (typeof raw !== "string" || raw.length === 0) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms) : null
}

async function fetchFolderPage(
  client: DriveClient,
  folderId: string,
  onlyVideos: boolean,
  pageSize: number,
  pageToken: string | undefined,
): Promise<DriveFilesApiResponse> {
  return client.request<DriveFilesApiResponse>("/drive/v3/files", {
    query: {
      q: buildFilesQuery(folderId, onlyVideos),
      fields:
        "files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,thumbnailLink),nextPageToken",
      pageSize,
      orderBy: "modifiedTime desc",
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    },
  })
}

async function upsertDriveFile(
  credentialId: number,
  userId: number,
  file: DriveFileApiItem,
  result: SyncResult,
): Promise<void> {
  const driveModifiedAt = safeDate(file.modifiedTime)
  const driveCreatedAt = safeDate(file.createdTime)
  const sizeBytes = safeBigInt(file.size)

  const existing = await prisma.driveFile.findUnique({
    where: { credentialId_driveFileId: { credentialId, driveFileId: file.id } },
  })

  if (!existing) {
    await prisma.driveFile.create({
      data: {
        userId,
        credentialId,
        driveFileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes,
        driveCreatedAt,
        driveModifiedAt,
        driveUrl: file.webViewLink ?? null,
        thumbnailUrl: file.thumbnailLink ?? null,
        syncStatus: "detected",
        lastSyncedAt: new Date(),
      },
    })
    result.created += 1
    return
  }

  const remoteMtime = driveModifiedAt?.getTime() ?? null
  const localMtime = existing.driveModifiedAt?.getTime() ?? null
  const sizeChanged =
    (existing.sizeBytes?.toString() ?? null) !== (sizeBytes?.toString() ?? null)
  const nameChanged = existing.name !== file.name
  const mtimeChanged = remoteMtime !== localMtime

  if (mtimeChanged || sizeChanged || nameChanged) {
    await prisma.driveFile.update({
      where: { id: existing.id },
      data: {
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes,
        driveModifiedAt,
        driveCreatedAt,
        driveUrl: file.webViewLink ?? null,
        thumbnailUrl: file.thumbnailLink ?? null,
        lastSyncedAt: new Date(),
      },
    })
    result.updated += 1
    return
  }

  await prisma.driveFile.update({
    where: { id: existing.id },
    data: { lastSyncedAt: new Date() },
  })
  result.skipped += 1
}

export async function syncDriveFiles(opts: SyncOptions): Promise<SyncResult> {
  if (!FOLDER_ID_PATTERN.test(opts.folderId)) {
    throw createError({
      statusCode: 400,
      message:
        "Невалидный folderId. Укажите ID папки Google Drive (из URL: drive.google.com/drive/folders/<ID>)",
    })
  }

  const credential = await loadDriveCredential(opts.credentialId, opts.userId)
  const client = createDriveClient(credential.accessToken)
  const onlyVideos = opts.onlyVideos !== false
  const pageSize = Math.min(Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE), 100)

  const result: SyncResult = {
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetchFolderPage(client, opts.folderId, onlyVideos, pageSize, pageToken)
    const files = response.files ?? []
    for (const file of files) {
      result.scanned += 1
      try {
        await upsertDriveFile(opts.credentialId, opts.userId, file, result)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Неизвестная ошибка"
        result.errors.push({ driveFileId: file.id, message })
      }
    }
    if (!response.nextPageToken) break
    pageToken = response.nextPageToken
  }

  await logAgent(
    "drive-sync",
    "info",
    `Drive sync folder=${opts.folderId} cred=${opts.credentialId} scanned=${result.scanned} created=${result.created} updated=${result.updated} skipped=${result.skipped} errors=${result.errors.length}`,
  ).catch(() => {})

  return result
}

export async function refreshDriveFileMetadata(fileId: number): Promise<void> {
  const file = await prisma.driveFile.findUnique({ where: { id: fileId } })
  if (!file) return
  let credential
  try {
    credential = await loadDriveCredential(file.credentialId, file.userId)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Неизвестная ошибка"
    await prisma.driveFile.update({
      where: { id: fileId },
      data: { syncStatus: "failed", syncError: message, lastSyncedAt: new Date() },
    })
    return
  }
  const client = createDriveClient(credential.accessToken)

  try {
    const remote = await client.request<DriveFileApiItem>(
      `/drive/v3/files/${encodeURIComponent(file.driveFileId)}`,
      {
        query: {
          fields:
            "id,name,mimeType,size,createdTime,modifiedTime,webViewLink,thumbnailLink",
          supportsAllDrives: true,
        },
      },
    )

    const sizeBytes = safeBigInt(remote.size)
    const driveModifiedAt = safeDate(remote.modifiedTime)
    const nextStatus = file.syncStatus === "failed" ? "detected" : file.syncStatus

    await prisma.driveFile.update({
      where: { id: fileId },
      data: {
        name: remote.name,
        mimeType: remote.mimeType,
        sizeBytes,
        driveModifiedAt,
        driveUrl: remote.webViewLink ?? null,
        thumbnailUrl: remote.thumbnailLink ?? null,
        syncStatus: nextStatus,
        syncError: null,
        lastSyncedAt: new Date(),
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Неизвестная ошибка"
    await prisma.driveFile.update({
      where: { id: fileId },
      data: { syncStatus: "failed", syncError: message, lastSyncedAt: new Date() },
    })
  }
}
