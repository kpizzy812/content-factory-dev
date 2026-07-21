/**
 * Google Drive REST v3 folder browsing/creation helpers.
 *
 * Использует DriveClient (с уже вшитым access_token), чтобы caller не возился
 * с авторизацией. Поддерживает Shared Drives через supportsAllDrives + includeItemsFromAllDrives.
 */
import type { DriveClient } from "./client"

const FOLDER_MIME = "application/vnd.google-apps.folder"
const PARENT_ID_PATTERN = /^[a-zA-Z0-9_\-]+$/
const DEFAULT_PAGE_SIZE = 50

export interface DriveFolder {
  id: string
  name: string
  parentId: string | null
  modifiedTime?: string
  webViewLink?: string
  canCreateChildren: boolean
}

export interface ListFoldersOptions {
  parentId?: string | null
  q?: string | null
  pageToken?: string | null
  pageSize?: number
}

export interface ListFoldersResult {
  folders: DriveFolder[]
  nextPageToken?: string
}

interface DriveFileApiItem {
  id: string
  name: string
  parents?: string[]
  modifiedTime?: string
  webViewLink?: string
  capabilities?: { canAddChildren?: boolean }
}

interface DriveFilesApiResponse {
  files?: DriveFileApiItem[]
  nextPageToken?: string
}

function buildFoldersQuery(options: ListFoldersOptions): string {
  const search = (options.q ?? "").trim()
  const clauses = [`mimeType='${FOLDER_MIME}'`, "trashed=false"]
  if (search) {
    const safe = search.replace(/'/g, "\\'")
    clauses.push(`name contains '${safe}'`)
    return clauses.join(" and ")
  }
  const parent = (options.parentId ?? "").trim()
  // У Service Account нет My Drive - расшаренные на email папки лежат
  // в виртуальной "Shared with me" области, без parent. На root view
  // фильтруем sharedWithMe=true, чтобы увидеть всё что отшарили.
  if (!parent || parent === "root") {
    clauses.push("sharedWithMe=true")
    return clauses.join(" and ")
  }
  if (!PARENT_ID_PATTERN.test(parent)) {
    throw createError({ statusCode: 400, message: "Невалидный parentId" })
  }
  clauses.push(`'${parent}' in parents`)
  return clauses.join(" and ")
}

export async function listFolders(
  client: DriveClient,
  options: ListFoldersOptions = {},
): Promise<ListFoldersResult> {
  const q = buildFoldersQuery(options)
  const pageSize = Math.min(Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE), 100)

  const response = await client.request<DriveFilesApiResponse>("/drive/v3/files", {
    query: {
      q,
      fields:
        "files(id,name,parents,modifiedTime,webViewLink,capabilities/canAddChildren),nextPageToken",
      pageSize,
      orderBy: "name",
      pageToken: options.pageToken ?? undefined,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    },
  })

  const folders: DriveFolder[] = (response.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parents?.[0] ?? null,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    canCreateChildren: f.capabilities?.canAddChildren ?? true,
  }))

  return { folders, nextPageToken: response.nextPageToken }
}

export interface CreateFolderOptions {
  name: string
  parentId?: string | null
}

export async function createFolder(
  client: DriveClient,
  options: CreateFolderOptions,
): Promise<DriveFolder> {
  const name = (options.name ?? "").trim()
  if (!name) {
    throw createError({ statusCode: 400, message: "Имя папки обязательно" })
  }
  if (name.length > 255) {
    throw createError({
      statusCode: 400,
      message: "Имя папки слишком длинное (максимум 255 символов)",
    })
  }
  if (name.includes("/")) {
    throw createError({
      statusCode: 400,
      message: "Имя папки не должно содержать символ '/'",
    })
  }

  const parentId = (options.parentId ?? "").trim() || null
  if (parentId && !PARENT_ID_PATTERN.test(parentId)) {
    throw createError({ statusCode: 400, message: "Невалидный parentId" })
  }

  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME }
  if (parentId) body.parents = [parentId]

  const response = await client.request<DriveFileApiItem>("/drive/v3/files", {
    method: "POST",
    query: { fields: "id,name,parents,webViewLink", supportsAllDrives: true },
    body,
  })

  return {
    id: response.id,
    name: response.name,
    parentId: response.parents?.[0] ?? null,
    webViewLink: response.webViewLink,
    canCreateChildren: true,
  }
}
