<script setup lang="ts">
/**
 * Карточка одного пресета субтитров. Показывает превью (видео если есть, иначе CSS-имитация
 * с двумя цветами текста + accent), название, теги, заметку (например AI-стоимость).
 *
 * При клике эмитит select. Selected состояние подсвечивается ring+ring-primary.
 */

import type { SubtitlePresetMeta, SubtitlePresetTag } from '~~/shared/types/subtitle-preset'

const props = defineProps<{
  preset: SubtitlePresetMeta
  selected: boolean
  /** Компактный вариант для встраивания в pipeline-config (меньше padding и шрифт). */
  compact?: boolean
}>()

defineEmits<{
  select: []
}>()

const tagLabels: Record<SubtitlePresetTag, string> = {
  classic: 'классика',
  bold: 'жирный',
  neon: 'неон',
  minimal: 'минимал',
  animated: 'анимация',
  karaoke: 'караоке',
  'creator-style': 'creator-style',
}

// CSS-имитация рендерится всегда как фон. Видео — overlay сверху, появляется только
// когда `canplay` событие сработало (файл реально загрузился и распарсился). При ошибке
// или отсутствии URL остаётся видна имитация. Полагаться только на 'error' нельзя — в
// dev режиме Nuxt отдаёт SPA-fallback HTML на 404 и event не всегда срабатывает.
const videoReady = ref(false)
const videoFailed = ref(false)
const hasSampleVideo = computed(() => !!props.preset.sampleVideoUrl)
const videoVisible = computed(() => hasSampleVideo.value && videoReady.value && !videoFailed.value)
</script>

<template>
  <button
    type="button"
    class="card card-compact card-border cursor-pointer transition-all overflow-hidden text-left"
    :class="[
      compact ? 'card-xs' : '',
      selected
        ? 'ring-2 ring-primary bg-base-200'
        : 'border border-base-300 hover:border-primary/50 hover:bg-base-200/50',
    ]"
    @click="$emit('select')"
  >
    <!-- Превью -->
    <figure class="aspect-video bg-base-300 relative flex items-center justify-center overflow-hidden">
      <!-- CSS-имитация: тёмный фон + образец текста стилем preset'а. Всегда виден; видео,
           если есть и загрузилось, ложится поверх через absolute. -->
      <div
        class="absolute inset-0 w-full h-full flex items-center justify-center"
        :style="{ background: 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)' }"
      >
        <div class="text-center px-2 leading-tight">
          <span
            class="font-black"
            :class="compact ? 'text-xs' : 'text-base'"
            :style="{ color: preset.previewTextColor }"
          >
            Это
            <span
              v-if="preset.previewAccentColor"
              :style="{ color: preset.previewAccentColor }"
              class="font-black"
            >секрет</span>
            <span v-else>секрет</span>
            миллионеров
          </span>
        </div>
      </div>
      <video
        v-if="hasSampleVideo"
        :src="preset.sampleVideoUrl!"
        autoplay
        loop
        muted
        playsinline
        preload="auto"
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
        :class="videoVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        @canplay="videoReady = true"
        @error="videoFailed = true"
      />
      <Icon
        v-if="selected"
        name="mingcute:check-circle-fill"
        class="absolute top-1 right-1 text-primary text-xl bg-base-100 rounded-full z-10"
      />
    </figure>

    <!-- Body -->
    <div class="card-body" :class="compact ? 'p-1.5' : 'p-2'">
      <div class="flex items-start justify-between gap-1">
        <h3
          class="card-title font-semibold leading-tight"
          :class="compact ? 'text-xs' : 'text-sm'"
        >
          {{ preset.label }}
        </h3>
      </div>
      <p
        v-if="!compact"
        class="text-[10px] text-base-content/60 line-clamp-2 leading-snug"
      >
        {{ preset.description }}
      </p>
      <div class="flex flex-wrap gap-0.5 mt-0.5">
        <span
          v-for="tag in preset.tags"
          :key="tag"
          class="badge badge-xs badge-neutral badge-soft"
        >
          {{ tagLabels[tag] ?? tag }}
        </span>
      </div>
      <div
        v-if="preset.previewExtraNote"
        class="text-[9px] text-base-content/50 mt-0.5 flex items-center gap-0.5"
      >
        <Icon
          v-if="preset.needsKeywordDetection"
          name="mingcute:sparkles-line"
          class="text-[10px]"
        />
        <span>{{ preset.previewExtraNote }}</span>
      </div>
    </div>
  </button>
</template>
