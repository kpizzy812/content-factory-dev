<script setup lang="ts">
import type { DriveFile } from '~/composables/useGoogleDrive'

definePageMeta({ middleware: 'module-access', moduleSlug: 'trendwatcher' })
useHead({ title: 'Google Drive' })

const {
  credentials,
  files,
  fetchCredentials,
  fetchFiles,
  testCredential,
  revokeCredential,
  deleteCredential,
  syncFolder,
  downloadFile,
} = useGoogleDrive()

const isModalOpen = ref(false)
const isImportModalOpen = ref(false)
const importTargetFile = ref<DriveFile | null>(null)
const selectedCredentialId = ref<number | null>(null)
const testingCredentialId = ref<number | null>(null)
const busyFileIds = ref<number[]>([])
const isSyncingFolder = ref(false)

interface Toast {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}
const toasts = ref<Toast[]>([])
let toastSeq = 0

function pushToast(type: Toast['type'], message: string) {
  const id = ++toastSeq
  toasts.value.push({ id, type, message })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, 4000)
}

function getErrorMessage(err: unknown, fallback: string): string {
  const data = err as { data?: { message?: string }, message?: string }
  return data?.data?.message || data?.message || fallback
}

async function refreshFiles() {
  if (!selectedCredentialId.value) return
  try {
    await fetchFiles({ credentialId: selectedCredentialId.value })
  } catch (err) {
    pushToast('error', getErrorMessage(err, 'Не удалось загрузить файлы'))
  }
}

async function handleCredentialCreated(id: number) {
  await fetchCredentials()
  selectedCredentialId.value = id
  pushToast('success', 'Аккаунт подключён')
  await refreshFiles()
}

async function handleTest(id: number) {
  testingCredentialId.value = id
  try {
    const res = await testCredential(id)
    if (res.ok) {
      pushToast('success', `Тест OK: найдено папок ${res.foldersFound}`)
    } else {
      pushToast('error', res.message)
    }
    await fetchCredentials()
  } catch (err) {
    pushToast('error', getErrorMessage(err, 'Тест не удался'))
  } finally {
    testingCredentialId.value = null
  }
}

async function handleRevoke(id: number) {
  if (!confirm('Отозвать credential? Доступ к Drive будет заблокирован.')) return
  try {
    await revokeCredential(id)
    pushToast('info', 'Credential отозван')
    if (selectedCredentialId.value === id) selectedCredentialId.value = null
  } catch (err) {
    pushToast('error', getErrorMessage(err, 'Не удалось отозвать'))
  }
}

async function handleDelete(id: number) {
  try {
    await deleteCredential(id)
    pushToast('info', 'Credential удалён')
    if (selectedCredentialId.value === id) selectedCredentialId.value = null
  } catch (err) {
    pushToast('error', getErrorMessage(err, 'Не удалось удалить'))
  }
}

function handleSelected(id: number) {
  selectedCredentialId.value = id
  refreshFiles()
}

async function handleSync(payload: { credentialId: number, folderId: string, onlyVideos: boolean }) {
  isSyncingFolder.value = true
  try {
    const res = await syncFolder(payload)
    pushToast(
      'success',
      `Sync: scanned=${res.scanned}, created=${res.created}, updated=${res.updated}, skipped=${res.skipped}`,
    )
    await refreshFiles()
  } catch (err) {
    pushToast('error', getErrorMessage(err, 'Sync не удался'))
  } finally {
    isSyncingFolder.value = false
  }
}

async function handleDownload(fileId: number) {
  busyFileIds.value.push(fileId)
  try {
    await downloadFile(fileId)
    pushToast('success', 'Файл скачан')
    await refreshFiles()
  } catch (err) {
    pushToast('error', getErrorMessage(err, 'Скачивание не удалось'))
    await refreshFiles()
  } finally {
    busyFileIds.value = busyFileIds.value.filter(id => id !== fileId)
  }
}

function handleImport(fileId: number) {
  const f = files.value.find(x => x.id === fileId) ?? null
  if (!f) return
  importTargetFile.value = f
  isImportModalOpen.value = true
}

async function handleImported(payload: { videoId: number, fileId: number }) {
  pushToast('success', `Создано Video #${payload.videoId}`)
  await refreshFiles()
}

function handleOpenDrive(url: string) {
  window.open(url, '_blank')
}

onMounted(async () => {
  try {
    await fetchCredentials()
    if (credentials.value.length > 0 && credentials.value[0]) {
      selectedCredentialId.value = credentials.value[0].id
      await refreshFiles()
    }
  } catch (err) {
    pushToast('error', getErrorMessage(err, 'Не удалось загрузить credentials'))
  }
})
</script>

<template>
  <div class="max-w-7xl mx-auto p-2 md:p-4 space-y-6">
    <!-- Empty state -->
    <div v-if="credentials.length === 0" class="hero min-h-[60vh]">
      <div class="hero-content text-center">
        <div class="max-w-md">
          <Icon name="mingcute:cloud-line" class="h-24 w-24 text-primary mx-auto mb-4" />
          <h1 class="text-3xl font-bold mb-2">Google Drive</h1>
          <p class="text-base-content/70 mb-4">
            Подключите Google Drive аккаунт, чтобы импортировать креативы и использовать их как видео в пайплайне.
          </p>
          <p class="text-xs text-base-content/60 mb-6">
            Понадобится JSON service account из Google Cloud Console с правами drive.readonly.
          </p>
          <button class="btn btn-primary btn-lg" @click="isModalOpen = true">
            <Icon name="mingcute:link-line" class="h-5 w-5" />
            Подключить Drive
          </button>
        </div>
      </div>
    </div>

    <!-- With credentials -->
    <template v-else>
      <header>
        <h1 class="text-3xl font-bold flex items-center gap-2">
          <Icon name="mingcute:cloud-line" class="h-8 w-8 text-primary" />
          Google Drive
        </h1>
        <p class="text-sm text-base-content/70">
          Импорт креативов из Google Drive в пайплайн ZavodCamp.
        </p>
      </header>

      <DriveCredentialsSection
        :credentials="credentials"
        :selected-credential-id="selectedCredentialId"
        :testing-credential-id="testingCredentialId"
        @add="isModalOpen = true"
        @test="handleTest"
        @revoke="handleRevoke"
        @delete="handleDelete"
        @selected="handleSelected"
      />

      <DriveBrowserSection
        v-if="selectedCredentialId !== null"
        :credential-id="selectedCredentialId"
        :files="files"
        :busy-file-ids="busyFileIds"
        :is-syncing="isSyncingFolder"
        @sync="handleSync"
        @download="handleDownload"
        @import-video="handleImport"
        @open-drive="handleOpenDrive"
      />
    </template>

    <ClientOnly>
      <ServiceAccountSetupModal
        v-model="isModalOpen"
        @created="handleCredentialCreated"
      />
      <DriveImportToVideoModal
        v-model="isImportModalOpen"
        :file="importTargetFile"
        @imported="handleImported"
      />
    </ClientOnly>

    <!-- Toasts -->
    <div v-if="toasts.length > 0" class="toast toast-end z-50">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="alert"
        :class="{
          'alert-success': t.type === 'success',
          'alert-error': t.type === 'error',
          'alert-info': t.type === 'info',
        }"
      >
        <span>{{ t.message }}</span>
      </div>
    </div>
  </div>
</template>
