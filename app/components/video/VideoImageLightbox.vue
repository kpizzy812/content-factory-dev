<script setup lang="ts">
import { onAssetMissing } from '~/utils/image-fallback'

const props = defineProps<{
  images: Array<{ id: number; fileUrl: string | null; prompt: string | null; order: number }>
  initialIndex?: number
}>()
const emit = defineEmits<{ close: [] }>()

const currentIndex = ref(props.initialIndex ?? 0)
const currentImage = computed(() => props.images[currentIndex.value])

function next() { if (currentIndex.value < props.images.length - 1) currentIndex.value++ }
function prev() { if (currentIndex.value > 0) currentIndex.value-- }
function downloadImage() {
  if (!currentImage.value?.fileUrl) return
  const a = document.createElement('a')
  a.href = `/api/files/${currentImage.value.fileUrl}`
  a.download = `image_${currentImage.value.order + 1}.png`
  a.click()
}

// Keyboard navigation
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'ArrowRight') next()
  if (e.key === 'ArrowLeft') prev()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center"
      @click.self="emit('close')"
    >
      <!-- Close button -->
      <button
        class="absolute top-4 right-4 btn btn-circle btn-ghost text-white hover:bg-white/20"
        @click="emit('close')"
      >
        <Icon name="mingcute:close-line" class="text-xl" />
      </button>

      <!-- Download button -->
      <button
        class="absolute top-4 right-20 btn btn-circle btn-ghost text-white hover:bg-white/20"
        @click="downloadImage"
      >
        <Icon name="mingcute:download-2-line" class="text-xl" />
      </button>

      <!-- Counter -->
      <div class="absolute top-4 left-4 text-white/70 text-sm font-medium">
        {{ currentIndex + 1 }} / {{ images.length }}
      </div>

      <!-- Navigation arrows -->
      <button
        v-if="currentIndex > 0"
        class="absolute left-4 top-1/2 -translate-y-1/2 btn btn-circle btn-ghost text-white hover:bg-white/20"
        @click="prev"
      >
        <Icon name="mingcute:arrow-left-line" class="text-2xl" />
      </button>
      <button
        v-if="currentIndex < images.length - 1"
        class="absolute right-4 top-1/2 -translate-y-1/2 btn btn-circle btn-ghost text-white hover:bg-white/20"
        @click="next"
      >
        <Icon name="mingcute:arrow-right-line" class="text-2xl" />
      </button>

      <!-- Image -->
      <div class="flex-1 flex items-center justify-center w-full px-16 py-16">
        <img
          v-if="currentImage?.fileUrl"
          :src="`/api/files/${currentImage.fileUrl}`"
          alt="Изображение"
          class="max-w-full max-h-full object-contain rounded-lg"
          @error="onAssetMissing"
        />
      </div>

      <!-- Prompt text -->
      <div v-if="currentImage?.prompt" class="w-full max-w-2xl px-4 pb-6">
        <p class="text-white/70 text-sm text-center whitespace-pre-line">{{ currentImage.prompt }}</p>
      </div>
    </div>
  </Teleport>
</template>
