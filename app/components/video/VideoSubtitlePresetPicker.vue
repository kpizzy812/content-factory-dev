<script setup lang="ts">
/**
 * Выбор пресета субтитров. Сетка карточек; компактный режим — для боковых панелей.
 *
 * Предупреждение про платный анализ ключевых слов появляется только у тех
 * пресетов, которым он нужен, и сразу под выбором: решение денежное.
 */
import type { SubtitlePresetKey } from '~~/shared/types/subtitle-preset'

const props = defineProps<{
  modelValue: SubtitlePresetKey | string | null | undefined
  compact?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: SubtitlePresetKey] }>()

const { presets, loading, error, getPreset } = useSubtitlePresets()

const selectedPreset = computed(() => getPreset(props.modelValue))
</script>

<template>
  <div class="flex flex-col gap-2">
    <UiSkeleton v-if="loading" variant="cards" :count="4" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить пресеты"
      :message="error.message ?? 'Причина неизвестна'"
    />

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
        @select="emit('update:modelValue', preset.key)"
      />
    </div>

    <p
      v-if="selectedPreset?.needsKeywordDetection"
      class="rounded-md border border-info-border bg-info-bg p-2 text-sm text-muted"
    >
      Пресет «{{ selectedPreset.label }}» при сборке запускает разбор ключевых слов моделью —
      около $0.001 за ролик. Отключается в настройках конвейера.
    </p>
  </div>
</template>
