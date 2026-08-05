<script setup lang="ts">
/**
 * Плеер готового ролика. Источник: design-preview/catalog/03-detail-video.dc.html
 *
 * Ширина у вертикального формата фиксированная, а не «сколько влезет»: рядом
 * стоят свойства и связи, и плеер не должен их выдавливать.
 */
defineProps<{
  src: string
  format: string
}>()

const emit = defineEmits<{ error: [event: Event] }>()
</script>

<template>
  <video
    :src="src"
    controls
    :autoplay="false"
    class="w-full rounded-md border border-border bg-surface"
    :class="format === 'portrait' ? 'aspect-[9/16] max-w-[236px]' : 'aspect-video max-w-2xl'"
    @error="emit('error', $event)"
  >
    Ваш браузер не поддерживает воспроизведение видео.
  </video>
</template>
