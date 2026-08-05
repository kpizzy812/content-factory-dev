<script setup lang="ts">
/**
 * Карточка пресета субтитров.
 *
 * Превью всегда тёмное и в обеих темах одинаковое: это имитация кадра ролика,
 * а не элемент интерфейса — белый и жёлтый текст пресета читаются только так.
 * Цвета текста приходят из самого пресета.
 *
 * CSS-имитация лежит фоном всегда, видео ложится поверх и появляется только
 * после `canplay`: в dev Nuxt отдаёт на 404 HTML-заглушку, и событие `error`
 * срабатывает не всегда.
 */
import type { SubtitlePresetMeta, SubtitlePresetTag } from '~~/shared/types/subtitle-preset'

const props = defineProps<{
  preset: SubtitlePresetMeta
  selected: boolean
  /** Компактный вариант для боковых панелей. */
  compact?: boolean
}>()

defineEmits<{ select: [] }>()

const TAG_LABELS: Record<SubtitlePresetTag, string> = {
  classic: 'классика',
  bold: 'жирный',
  neon: 'неон',
  minimal: 'минимал',
  animated: 'анимация',
  karaoke: 'караоке',
  'creator-style': 'creator-style',
}

const videoReady = ref(false)
const videoFailed = ref(false)
const hasSampleVideo = computed(() => !!props.preset.sampleVideoUrl)
const videoVisible = computed(() => hasSampleVideo.value && videoReady.value && !videoFailed.value)
</script>

<template>
  <button
    type="button"
    class="cursor-pointer overflow-hidden rounded-md border text-left transition-colors duration-(--duration-fast)"
    :class="selected ? 'border-accent bg-accent-bg' : 'border-border bg-card hover:border-subtle'"
    :aria-pressed="selected"
    @click="$emit('select')"
  >
    <span class="relative flex aspect-video items-center justify-center overflow-hidden">
      <span class="absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,#1a1a1a_0%,#2a2a2a_100%)]">
        <span class="px-2 text-center leading-tight font-black" :class="compact ? 'text-sm' : 'text-base'">
          <span :style="{ color: preset.previewTextColor }">Это </span>
          <span :style="{ color: preset.previewAccentColor ?? preset.previewTextColor }">секрет</span>
          <span :style="{ color: preset.previewTextColor }"> миллионеров</span>
        </span>
      </span>

      <video
        v-if="hasSampleVideo"
        :src="preset.sampleVideoUrl!"
        autoplay
        loop
        muted
        playsinline
        preload="auto"
        class="absolute inset-0 size-full object-cover transition-opacity duration-(--duration-fast)"
        :class="videoVisible ? 'opacity-100' : 'pointer-events-none opacity-0'"
        @canplay="videoReady = true"
        @error="videoFailed = true"
      />

      <Icon
        v-if="selected"
        name="mingcute:check-circle-fill"
        class="absolute top-1 right-1 z-10 rounded-full bg-panel text-lg text-accent"
      />
    </span>

    <span class="flex flex-col gap-1" :class="compact ? 'p-1.5' : 'p-2'">
      <span class="text-sm leading-tight font-medium">{{ preset.label }}</span>

      <span v-if="!compact" class="line-clamp-2 text-micro leading-snug text-muted">
        {{ preset.description }}
      </span>

      <span class="flex flex-wrap gap-1">
        <span
          v-for="tag in preset.tags"
          :key="tag"
          class="inline-flex h-[18px] items-center rounded-sm border border-neutral-border bg-neutral-bg px-1.5 text-micro text-neutral"
        >
          {{ TAG_LABELS[tag] ?? tag }}
        </span>
      </span>

      <span v-if="preset.previewExtraNote" class="flex items-center gap-1 text-micro text-subtle">
        <Icon v-if="preset.needsKeywordDetection" name="mingcute:magic-1-line" />
        {{ preset.previewExtraNote }}
      </span>
    </span>
  </button>
</template>
