<script setup lang="ts">
defineProps<{
  src: string
  format: string
}>()

const emit = defineEmits<{
  error: [event: Event]
}>()

function onError(event: Event) {
  emit('error', event)
}
</script>

<template>
  <div class="flex justify-center">
    <video
      :src="src"
      controls
      :autoplay="false"
      class="rounded-lg bg-base-300"
      :class="format === 'portrait' ? 'max-w-sm aspect-[9/16]' : 'max-w-2xl aspect-video w-full'"
      @error="onError"
    >
      Ваш браузер не поддерживает воспроизведение видео.
    </video>
  </div>
</template>
