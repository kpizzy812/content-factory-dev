<script setup lang="ts">
/**
 * Picker пресетов субтитров. Grid карточек, при клике эмитит update:modelValue.
 * Используется в VideoSubtitleEditor (per-video) и в pipeline-config (на контейнере).
 *
 * compact prop включает узкий режим карточек — для встраивания в боковые панели где места
 * мало.
 */

import type { SubtitlePresetKey } from '~~/shared/types/subtitle-preset'

const props = defineProps<{
  modelValue: SubtitlePresetKey | string | null | undefined
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SubtitlePresetKey]
}>()

const { presets, loading, error, getPreset } = useSubtitlePresets()

const selectedPreset = computed(() => getPreset(props.modelValue))

function pick(key: SubtitlePresetKey) {
  emit('update:modelValue', key)
}
</script>

<template>
  <div class="space-y-2">
    <div v-if="loading" class="flex justify-center py-4">
      <span class="loading loading-spinner loading-md" />
    </div>
    <div v-else-if="error" class="alert alert-error alert-soft text-xs py-2">
      <Icon name="mingcute:close-circle-line" />
      <span>Не удалось загрузить пресеты: {{ error.message ?? 'unknown' }}</span>
    </div>
    <div
      v-else
      class="grid gap-2"
      :class="compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'"
    >
      <VideoSubtitlePresetCard
        v-for="preset in presets"
        :key="preset.key"
        :preset="preset"
        :selected="modelValue === preset.key"
        :compact="compact"
        @select="pick(preset.key)"
      />
    </div>

    <div
      v-if="selectedPreset?.needsKeywordDetection"
      class="alert alert-info alert-soft text-xs py-1.5"
    >
      <Icon name="mingcute:sparkles-2-line" />
      <span>
        Для пресета <span class="font-semibold">{{ selectedPreset.label }}</span> при сборке
        запускается AI-анализ ключевых слов (~$0.001 за видео). Можно отключить вручную в
        Pipeline-настройках.
      </span>
    </div>
  </div>
</template>
