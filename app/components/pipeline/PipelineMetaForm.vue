<script setup lang="ts">
/**
 * Форма оформления конвейера: имя, описания, иконка, цвет, теги.
 *
 * Вынесена из модалки предпросмотра — там она занимала больше половины файла,
 * а сама модалка про просмотр, а не про правку.
 */
import { pipelineIcons } from '~~/shared/utils/pipeline-meta'
import { PIPELINE_COLOR_OPTIONS, pipelineColor } from './PipelineColorMap'

export interface PipelineMetaDraft {
  name: string
  description: string
  markdownDescription: string
  icon: string
  color: string
  tags: string[]
}

const props = defineProps<{ modelValue: PipelineMetaDraft }>()

const emit = defineEmits<{ 'update:modelValue': [value: PipelineMetaDraft] }>()

function patch(part: Partial<PipelineMetaDraft>) {
  emit('update:modelValue', { ...props.modelValue, ...part })
}

const preview = computed(() => pipelineColor(props.modelValue.color))
</script>

<template>
  <div class="flex flex-col gap-3">
    <UiField label="Название">
      <UiInput
        :model-value="modelValue.name"
        placeholder="Название конвейера"
        @update:model-value="(v) => patch({ name: v })"
      />
    </UiField>

    <UiField label="Краткое описание">
      <UiTextarea
        :model-value="modelValue.description"
        :rows="2"
        placeholder="Одна строка о том, что делает конвейер"
        @update:model-value="(v) => patch({ description: v })"
      />
    </UiField>

    <UiField label="Подробное описание" hint="Поддерживается Markdown">
      <UiTextarea
        :model-value="modelValue.markdownDescription"
        :rows="4"
        placeholder="Как читать граф, что настроить перед запуском"
        @update:model-value="(v) => patch({ markdownDescription: v })"
      />
    </UiField>

    <UiField label="Иконка">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="item in pipelineIcons"
          :key="item.value"
          type="button"
          class="flex size-8 cursor-pointer items-center justify-center rounded-md border"
          :class="modelValue.icon === item.value
            ? 'border-accent-border bg-accent-bg text-accent'
            : 'border-border bg-card text-muted hover:text-fg'"
          :title="item.label"
          @click="patch({ icon: item.value })"
        >
          <Icon :name="item.icon" class="text-lg" />
        </button>
      </div>
    </UiField>

    <UiField label="Цвет">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="item in PIPELINE_COLOR_OPTIONS"
          :key="item.value"
          type="button"
          class="flex size-8 cursor-pointer items-center justify-center rounded-md border"
          :class="[item.swatch, modelValue.color === item.value ? 'border-fg' : 'border-border']"
          :title="item.label"
          @click="patch({ color: item.value })"
        >
          <Icon v-if="modelValue.color === item.value" name="mingcute:check-line" class="text-inverse" />
        </button>
      </div>
    </UiField>

    <UiField label="Теги">
      <PipelineTagPicker
        :model-value="modelValue.tags"
        @update:model-value="(v) => patch({ tags: v })"
      />
    </UiField>

    <div v-if="modelValue.name.trim()" class="flex items-center gap-2.5 rounded-md border border-border bg-card p-2.5">
      <span class="flex size-8 items-center justify-center rounded-md" :class="preview.bg">
        <Icon :name="modelValue.icon || 'mingcute:git-merge-line'" class="text-lg" :class="preview.text" />
      </span>
      <span class="min-w-0">
        <span class="block truncate font-medium">{{ modelValue.name }}</span>
        <span v-if="modelValue.tags.length" class="block truncate text-sm text-subtle">
          {{ modelValue.tags.join(' · ') }}
        </span>
      </span>
    </div>
  </div>
</template>
