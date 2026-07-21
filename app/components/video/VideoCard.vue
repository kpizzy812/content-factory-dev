<script setup lang="ts">
import { onAssetMissing } from '~/utils/image-fallback'

const props = defineProps<{
  video: {
    id: number
    status: string
    format: string
    duration: number | null
    fileUrl: string | null
    createdAt: string
    assets?: { type: string; fileUrl: string | null }[]
    scenario?: { id: number; title: string } | null
  }
}>()

const formatLabel = computed(() => {
  return props.video.format === 'portrait'
    ? 'Вертикальное (TikTok)'
    : 'Горизонтальное (YouTube)'
})

const previewUrl = computed(() => {
  const firstImage = props.video.assets?.find(a => a.type === 'image' && a.fileUrl)
  return firstImage ? `/api/files/${firstImage.fileUrl}` : null
})

const durationFormatted = computed(() => {
  if (!props.video.duration) return null
  const seconds = props.video.duration
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `${min}:${String(sec).padStart(2, '0')}`
})

function goToDetail() {
  navigateTo(`/videos/${props.video.id}`)
}
</script>

<template>
  <div
    class="card bg-base-100 shadow-sm cursor-pointer transition-shadow hover:shadow-md"
    @click="goToDetail"
  >
    <!-- Превью -->
    <figure class="relative bg-base-200 aspect-video">
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt="Превью видео"
        class="w-full h-full object-cover"
        @error="onAssetMissing"
      />
      <div v-else class="flex items-center justify-center w-full h-full">
        <Icon name="mingcute:video-line" class="text-4xl text-base-content/20" />
      </div>

      <!-- Длительность -->
      <span
        v-if="durationFormatted"
        class="absolute bottom-2 right-2 badge badge-sm badge-neutral"
      >
        {{ durationFormatted }}
      </span>
    </figure>

    <div class="card-body p-4 gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <VideoStatusBadge :status="video.status" />
        <span class="badge badge-ghost badge-sm">
          {{ formatLabel }}
        </span>
      </div>

      <h3
        v-if="video.scenario"
        class="font-semibold text-base-content line-clamp-2 text-sm"
      >
        {{ video.scenario.variants?.[0]?.title ?? `Сценарий #${video.scenario.id}` }}
      </h3>
    </div>
  </div>
</template>
