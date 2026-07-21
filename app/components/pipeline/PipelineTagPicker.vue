<script setup lang="ts">
/**
 * Тонкая обёртка над `shared/TagPicker.vue`, фиксирующая endpoint pipeline'а.
 * Сохраняет публичный API (modelValue: string[]) — не ломает existing импортёров
 * PipelineCreateModal / PipelinePreviewModal.
 *
 * Pipeline хранит теги через relational M2M (PipelineTag), endpoint
 * `/api/pipelines/tags`. Реализация ушла в TagPicker.vue.
 */
defineProps<{
  modelValue: string[]
}>()

defineEmits<{
  'update:modelValue': [value: string[]]
}>()
</script>

<template>
  <SharedTagPicker
    :model-value="modelValue"
    endpoint="/api/pipelines/tags"
    placeholder="Добавить тег..."
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>
