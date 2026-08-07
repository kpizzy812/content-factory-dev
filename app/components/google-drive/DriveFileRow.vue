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

// Подписи доменные (стадия синхронизации файла), тон — из общего словаря.
const status = computed(() => {
  switch (props.file.syncStatus) {
    case 'detected':
      return { tone: 'border-info-border bg-info-bg text-info', label: 'Обнаружен', icon: 'mingcute:eye-line' }
    case 'downloading':
      return { tone: 'border-warning-border bg-warning-bg text-warning', label: 'Скачивается', icon: 'mingcute:loading-line', spinner: true }
    case 'downloaded':
      return { tone: 'border-success-border bg-success-bg text-success', label: 'Скачан', icon: 'mingcute:check-line' }
    case 'imported_to_video':
      return {
        tone: 'border-accent-border bg-accent-bg text-accent-text',
        label: `Импортирован #${props.file.videoId ?? '?'}`,
        icon: 'mingcute:video-line',
      }
    case 'failed':
      return { tone: 'border-danger-border bg-danger-bg text-danger', label: 'Ошибка', icon: 'mingcute:warning-line' }
    default:
      return { tone: 'border-neutral-border bg-neutral-bg text-neutral', label: props.file.syncStatus, icon: 'mingcute:question-line' }
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
    class="flex flex-wrap items-center gap-3 border-b border-divider p-3 transition-colors duration-(--duration-fast) ease-out last:border-0 hover:bg-card md:flex-nowrap"
  >
    <!-- Превью -->
    <div class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-card">
      <img
        v-if="file.thumbnailUrl"
        :src="file.thumbnailUrl"
        :alt="file.name"
        class="size-full object-cover"
      >
      <Icon v-else name="mingcute:video-line" class="text-lg text-subtle" />
    </div>

    <!-- Имя и мета -->
    <div class="min-w-0 max-w-full grow md:max-w-[40%]">
      <div class="truncate font-medium" :title="file.name">{{ file.name }}</div>
      <div class="flex items-center gap-2 text-sm text-muted">
        <span class="tnum">{{ formatBytes(file.sizeBytes) }}</span>
        <span class="hidden sm:inline">·</span>
        <span class="hidden truncate sm:inline">{{ file.mimeType }}</span>
      </div>
    </div>

    <!-- Состояние -->
    <span
      class="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm border px-2 text-sm"
      :class="status.tone"
      :title="file.syncStatus === 'failed' && file.syncError ? file.syncError : undefined"
    >
      <Icon :name="status.icon" class="shrink-0" :class="status.spinner && 'animate-spin'" />
      {{ status.label }}
    </span>

    <!-- Действия -->
    <div class="ml-auto flex shrink-0 items-center gap-1">
      <UiButton
        v-if="file.syncStatus === 'detected' || file.syncStatus === 'failed'"
        variant="primary"
        :loading="isBusy"
        @click="emit('download', file.id)"
      >
        <Icon v-if="!isBusy" name="mingcute:download-line" />
        Скачать
      </UiButton>

      <UiButton
        v-if="file.syncStatus === 'downloaded'"
        :disabled="isBusy"
        @click="emit('importVideo', file.id)"
      >
        <Icon name="mingcute:video-line" />
        Импорт в ролики
      </UiButton>

      <NuxtLink
        v-if="file.syncStatus === 'imported_to_video' && file.videoId"
        :to="`/videos/${file.videoId}`"
      >
        <UiButton variant="ghost">
          <Icon name="mingcute:right-line" />
          Перейти к ролику #{{ file.videoId }}
        </UiButton>
      </NuxtLink>

      <UiButton
        v-if="file.driveUrl"
        variant="ghost"
        icon-only
        title="Открыть в Google Drive"
        aria-label="Открыть в Google Drive"
        @click="handleOpenDrive"
      >
        <Icon name="mingcute:external-link-line" />
      </UiButton>
    </div>
  </div>
</template>
