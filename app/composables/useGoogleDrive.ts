/**
 * Composable для работы с Google Drive интеграцией.
 *
 * Содержит shared state (credentials/folders/files) и обёртки над $fetch.
 * Уведомления и refresh — на стороне caller'ов (страница/компоненты).
 */

export interface DriveCredential {
  id: number
  name: string
  description: string | null
  type: string
  metadata: ({ kind?: string } & Record<string, unknown>) | null
  expiresAt: string | null
  lastTestedAt: string | null
  lastTestStatus: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DriveFolder {
  id: string
  name: string
  parentId?: string
  modifiedTime?: string
  webViewLink?: string
}

export interface DriveFile {
  id: number
  driveFileId: string
  name: string
  mimeType: string
  sizeBytes: number | string | null
  driveCreatedAt: string | null
  driveModifiedAt: string | null
  driveUrl: string | null
  thumbnailUrl: string | null
  videoId: number | null
  syncStatus: 'detected' | 'downloading' | 'downloaded' | 'imported_to_video' | 'failed'
  localPath: string | null
  lastSyncedAt: string | null
  syncError: string | null
  hasGeneratedCaption: boolean
  createdAt: string
  credentialId: number
}

export interface SyncResult {
  scanned: number
  created: number
  updated: number
  skipped: number
  errors: { driveFileId: string, message: string }[]
}

export interface DriveTestResult {
  ok: boolean
  message: string
  foldersFound: number
}

export interface DriveFilesFilters {
  credentialId?: number
  syncStatus?: string
  videoOnly?: boolean
}

const DRIVE_KIND = 'google_drive_service_account'

export function useGoogleDrive() {
  const credentials = useState<DriveCredential[]>('drive-credentials', () => [])
  const folders = useState<DriveFolder[]>('drive-folders', () => [])
  const files = useState<DriveFile[]>('drive-files', () => [])
  const isLoading = useState<boolean>('drive-loading', () => false)

  async function fetchCredentials(): Promise<DriveCredential[]> {
    isLoading.value = true
    try {
      const res = await $fetch<{ data: DriveCredential[] }>('/api/pipelines/credentials')
      const filtered = (res.data ?? []).filter(
        c => (c.metadata as { kind?: string } | null)?.kind === DRIVE_KIND,
      )
      credentials.value = filtered
      return filtered
    } finally {
      isLoading.value = false
    }
  }

  async function createCredential(payload: {
    name: string
    description?: string
    serviceAccountJson: string
  }): Promise<DriveCredential> {
    // Парсим Service Account JSON чтобы извлечь client_email и project_id
    // и сохранить их в metadata. Сами секреты (private_key и т.п.) идут
    // в зашифрованный secretData и в metadata НЕ попадают.
    let parsedSA: { client_email?: unknown, project_id?: unknown } = {}
    try {
      parsedSA = JSON.parse(payload.serviceAccountJson) as typeof parsedSA
    } catch {
      throw new Error('Невалидный JSON Service Account')
    }
    if (typeof parsedSA.client_email !== 'string' || parsedSA.client_email.length === 0) {
      throw new Error('Service Account JSON не содержит client_email')
    }

    const metadata: Record<string, unknown> = {
      kind: DRIVE_KIND,
      clientEmail: parsedSA.client_email,
    }
    if (typeof parsedSA.project_id === 'string' && parsedSA.project_id.length > 0) {
      metadata.projectId = parsedSA.project_id
    }

    const res = await $fetch<{ data: DriveCredential }>('/api/pipelines/credentials', {
      method: 'POST',
      body: {
        name: payload.name,
        description: payload.description ?? null,
        type: 'custom',
        secretData: { json: payload.serviceAccountJson },
        metadata,
      },
    })
    credentials.value = [res.data, ...credentials.value]
    return res.data
  }

  async function testCredential(id: number): Promise<DriveTestResult> {
    const res = await $fetch<{ data: DriveTestResult }>(
      `/api/pipelines/credentials/${id}/test-drive`,
      { method: 'POST' },
    )
    return res.data
  }

  async function revokeCredential(id: number): Promise<void> {
    await $fetch(`/api/pipelines/credentials/${id}/revoke`, { method: 'POST' })
    await fetchCredentials()
  }

  async function deleteCredential(id: number): Promise<void> {
    await $fetch(`/api/pipelines/credentials/${id}`, { method: 'DELETE' })
    credentials.value = credentials.value.filter(c => c.id !== id)
  }

  async function listFolders(credentialId: number, parentId?: string): Promise<DriveFolder[]> {
    const res = await $fetch<{ data: { folders: DriveFolder[], nextPageToken?: string } }>(
      '/api/google-drive/folders',
      { query: { credentialId, parentId } },
    )
    folders.value = res.data.folders
    return res.data.folders
  }

  async function syncFolder(payload: {
    credentialId: number
    folderId: string
    onlyVideos?: boolean
  }): Promise<SyncResult> {
    const res = await $fetch<{ data: SyncResult }>('/api/google-drive/sync', {
      method: 'POST',
      body: payload,
    })
    return res.data
  }

  async function fetchFiles(filters?: DriveFilesFilters): Promise<DriveFile[]> {
    const res = await $fetch<{ data: DriveFile[], meta: { nextCursor?: number, total: number } }>(
      '/api/google-drive/files',
      { query: filters },
    )
    files.value = res.data
    return res.data
  }

  async function downloadFile(id: number): Promise<{
    id: number
    localPath: string
    sizeBytes: number | string
    syncStatus: string
  }> {
    const res = await $fetch<{
      data: { id: number, localPath: string, sizeBytes: number | string, syncStatus: string }
    }>(`/api/google-drive/files/${id}/download`, { method: 'POST' })
    return res.data
  }

  async function importToVideo(
    id: number,
    payload: { scenarioId: number, applicationId?: number, format?: 'portrait' | 'landscape' },
  ): Promise<{ videoId: number, driveFileId: number }> {
    const res = await $fetch<{ data: { videoId: number, driveFileId: number } }>(
      `/api/google-drive/files/${id}/import-to-video`,
      { method: 'POST', body: payload },
    )
    return res.data
  }

  return {
    credentials,
    folders,
    files,
    isLoading,
    fetchCredentials,
    createCredential,
    testCredential,
    revokeCredential,
    deleteCredential,
    listFolders,
    syncFolder,
    fetchFiles,
    downloadFile,
    importToVideo,
  }
}
