<script setup lang="ts">
import type { DriveFile, DriveFolder } from '~/composables/useGoogleDrive'

const props = defineProps<{
  credentialId: number
  files: DriveFile[]
  busyFileIds: number[]
  isSyncing?: boolean
}>()
const emit = defineEmits<{
  sync: [payload: { credentialId: number, folderId: string, onlyVideos: boolean }]
  download: [fileId: number]
  importVideo: [fileId: number]
  openDrive: [driveUrl: string]
}>()

const tab = ref<'folders' | 'files'>('folders')
const filterStatus = ref<'all' | DriveFile['syncStatus']>('all')
const search = ref('')

const filteredFiles = computed(() => {
  const term = search.value.trim().toLowerCase()
  return props.files.filter((f) => {
    if (filterStatus.value !== 'all' && f.syncStatus !== filterStatus.value) return false
    if (term && !f.name.toLowerCase().includes(term)) return false
    return true
  })
})

const STATUS_CHIPS: { value: 'all' | DriveFile['syncStatus'], label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'detected', label: 'Обнаружены' },
  { value: 'downloaded', label: 'Скачаны' },
  { value: 'imported_to_video', label: 'Импортированы' },
  { value: 'failed', label: 'Ошибки' },
]

function handleSync(payload: { credentialId: number, folderId: string, onlyVideos: boolean }) {
  emit('sync', payload)
  tab.value = 'files'
}

function handleSelect(_folder: DriveFolder) {
  // no-op: navigation внутри picker
}
</script>

<template>
  <section class="space-y-3">
    <div role="tablist" class="tabs tabs-box">
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': tab === 'folders' }"
        @click="tab = 'folders'"
      >
        <Icon name="mingcute:folder-line" class="h-4 w-4 mr-1" />
        Обзор папок
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': tab === 'files' }"
        @click="tab = 'files'"
      >
        <Icon name="mingcute:file-line" class="h-4 w-4 mr-1" />
        Файлы ({{ files.length }})
      </button>
    </div>

    <div v-if="tab === 'folders'">
      <DriveFolderPicker
        :credential-id="credentialId"
        :is-syncing="isSyncing"
        @select="handleSelect"
        @sync="handleSync"
      />
    </div>

    <div v-else class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <div class="join">
          <button
            v-for="chip in STATUS_CHIPS"
            :key="chip.value"
            class="btn btn-xs join-item"
            :class="{ 'btn-primary': filterStatus === chip.value }"
            @click="filterStatus = chip.value"
          >
            {{ chip.label }}
          </button>
        </div>
        <input
          v-model="search"
          type="text"
          placeholder="Поиск по имени"
          class="input input-sm grow max-w-xs"
        >
      </div>

      <div v-if="filteredFiles.length === 0" class="text-center py-12 text-base-content/60 border border-base-300 rounded-box">
        <Icon name="mingcute:file-line" class="h-12 w-12 mx-auto mb-2" />
        <p>Файлов нет</p>
        <p class="text-xs mt-1">Запустите sync во вкладке «Обзор папок»</p>
      </div>

      <div v-else class="border border-base-300 rounded-box bg-base-100 overflow-hidden">
        <DriveFileRow
          v-for="file in filteredFiles"
          :key="file.id"
          :file="file"
          :is-busy="busyFileIds.includes(file.id)"
          @download="emit('download', $event)"
          @import-video="emit('importVideo', $event)"
          @open-drive="emit('openDrive', $event)"
        />
      </div>
    </div>
  </section>
</template>
