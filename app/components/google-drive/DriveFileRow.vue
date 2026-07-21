<script setup lang="ts">
import type { DriveFile } from '~/composables/useGoogleDrive'
import { formatBytes } from '~/utils/format-bytes'

const props = defineProps<{
  file: DriveFile
  isBusy?: boolean
}>()
const emit = defineEmits<{
  download: [fileId: number]
  importVideo: [fileId: number]
  openDrive: [driveUrl: string]
}>()

const status = computed(() => {
  switch (props.file.syncStatus) {
    case 'detected':
      return { class: 'badge-info', label: 'Обнаружен', icon: 'mingcute:eye-line' }
    case 'downloading':
      return { class: 'badge-warning', label: 'Скачивается', icon: 'mingcute:download-line', spinner: true }
    case 'downloaded':
      return { class: 'badge-success', label: 'Скачан', icon: 'mingcute:check-line' }
    case 'imported_to_video':
      return {
        class: 'badge-primary',
        label: `Импортирован #${props.file.videoId ?? '?'}`,
        icon: 'mingcute:video-line',
      }
    case 'failed':
      return { class: 'badge-error', label: 'Ошибка', icon: 'mingcute:warning-line' }
    default:
      return { class: 'badge-ghost', label: props.file.syncStatus, icon: 'mingcute:question-line' }
  }
})

function handleOpenDrive() {
  if (props.file.driveUrl) {
    emit('openDrive', props.file.driveUrl)
  }
}
</script>

<template>
  <div
    class="flex flex-wrap md:flex-nowrap items-center gap-3 p-3 border-b border-base-300 hover:bg-base-200/50 transition-colors"
  >
    <!-- Thumbnail -->
    <div class="shrink-0 w-12 h-12 rounded bg-base-200 flex items-center justify-center overflow-hidden">
      <img
        v-if="file.thumbnailUrl"
        :src="file.thumbnailUrl"
        :alt="file.name"
        class="w-full h-full object-cover"
      >
      <Icon v-else name="mingcute:video-line" class="h-6 w-6 text-base-content/50" />
    </div>

    <!-- Name + meta -->
    <div class="grow min-w-0 max-w-full md:max-w-[40%]">
      <div class="font-medium truncate" :title="file.name">{{ file.name }}</div>
      <div class="text-xs text-base-content/60 flex items-center gap-2">
        <span>{{ formatBytes(file.sizeBytes) }}</span>
        <span class="hidden sm:inline">•</span>
        <span class="hidden sm:inline truncate">{{ file.mimeType }}</span>
      </div>
    </div>

    <!-- Status -->
    <div class="flex items-center gap-1 shrink-0">
      <span
        class="badge gap-1"
        :class="status.class"
        :title="file.syncStatus === 'failed' && file.syncError ? file.syncError : undefined"
      >
        <span v-if="status.spinner" class="loading loading-spinner loading-xs" />
        <Icon v-else :name="status.icon" class="h-3 w-3" />
        {{ status.label }}
      </span>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-1 shrink-0 ml-auto">
      <button
        v-if="file.syncStatus === 'detected' || file.syncStatus === 'failed'"
        class="btn btn-xs btn-primary"
        :disabled="isBusy"
        @click="emit('download', file.id)"
      >
        <span v-if="isBusy" class="loading loading-spinner loading-xs" />
        <Icon v-else name="mingcute:download-line" class="h-3 w-3" />
        Скачать
      </button>

      <button
        v-if="file.syncStatus === 'downloaded'"
        class="btn btn-xs btn-secondary"
        :disabled="isBusy"
        @click="emit('importVideo', file.id)"
      >
        <Icon name="mingcute:video-line" class="h-3 w-3" />
        Импорт в Video
      </button>

      <NuxtLink
        v-if="file.syncStatus === 'imported_to_video' && file.videoId"
        :to="`/videos/${file.videoId}`"
        class="btn btn-xs btn-ghost"
      >
        <Icon name="mingcute:right-line" class="h-3 w-3" />
        Перейти к Video #{{ file.videoId }}
      </NuxtLink>

      <button
        v-if="file.driveUrl"
        class="btn btn-xs btn-ghost"
        title="Открыть в Google Drive"
        aria-label="Открыть в Google Drive"
        @click="handleOpenDrive"
      >
        <Icon name="mingcute:external-link-line" class="h-3 w-3" />
      </button>
    </div>
  </div>
</template>
