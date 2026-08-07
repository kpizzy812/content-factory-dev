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
  <section class="flex flex-col gap-3">
    <div role="tablist" class="flex gap-1 border-b border-divider">
      <button
        role="tab"
        type="button"
        class="flex cursor-pointer items-center gap-1 border-b-2 px-2 pb-1.5 font-medium transition-colors duration-(--duration-fast) ease-out"
        :class="tab === 'folders' ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'"
        @click="tab = 'folders'"
      >
        <Icon name="mingcute:folder-line" />
        Обзор папок
      </button>
      <button
        role="tab"
        type="button"
        class="flex cursor-pointer items-center gap-1 border-b-2 px-2 pb-1.5 font-medium transition-colors duration-(--duration-fast) ease-out"
        :class="tab === 'files' ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'"
        @click="tab = 'files'"
      >
        <Icon name="mingcute:file-line" />
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

    <div v-else class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex flex-wrap gap-1.5">
          <UiButton
            v-for="chip in STATUS_CHIPS"
            :key="chip.value"
            :variant="filterStatus === chip.value ? 'primary' : 'secondary'"
            @click="filterStatus = chip.value"
          >
            {{ chip.label }}
          </UiButton>
        </div>
        <UiInput v-model="search" placeholder="Поиск по имени" class="max-w-xs grow" />
      </div>

      <div
        v-if="filteredFiles.length === 0"
        class="flex flex-col items-center gap-1 rounded-lg border border-border py-12 text-center text-muted"
      >
        <Icon name="mingcute:file-line" class="mb-1 text-3xl text-subtle" />
        <p>Файлов нет</p>
        <p class="text-micro text-subtle">Запустите синхронизацию во вкладке «Обзор папок»</p>
      </div>

      <div v-else class="overflow-hidden rounded-lg border border-border bg-panel">
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
