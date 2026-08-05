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

// Раздел относится к унаследованному контуру: при выключенной зоне его API
// отдаёт 404, и это конфигурация, а не поломка.
const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()
const zoneOff = computed(() => !legacyModules.value.googleDrive)

// Свой контейнер тостов был до общего — теперь используем общий.
const toast = useToast()

function pushToast(type: 'success' | 'error' | 'info', message: string) {
  toast[type](message)
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
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Google Drive</h1>
      <span class="flex-1" />
      <UiButton v-if="!zoneOff && credentials.length" variant="primary" @click="isModalOpen = true">
        <Icon name="mingcute:add-line" />
        Подключить ещё
      </UiButton>
    </div>

    <UiEmptyState
      v-if="zoneOff"
      variant="denied"
      title="Импорт из Google Drive выключен"
      description="Зона относится к унаследованному контуру и включается флагом LEGACY_GOOGLE_DRIVE_ENABLED в окружении."
    />

    <UiEmptyState
      v-else-if="!credentials.length"
      variant="first"
      icon="mingcute:cloud-line"
      title="Диск не подключён"
      description="Подключите сервисный аккаунт Google с правом drive.readonly — после этого файлы с диска можно импортировать как ролики."
    >
      <UiButton variant="primary" @click="isModalOpen = true">Подключить диск</UiButton>
    </UiEmptyState>

    <template v-else>
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
  </div>
</template>
