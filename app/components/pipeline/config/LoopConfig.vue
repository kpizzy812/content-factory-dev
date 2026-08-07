<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()
</script>

<template>
  <UiField label="Поле с массивом данных">
    <UiInput
      :model-value="config.arrayField || 'items'"
      placeholder="items"
      @update:model-value="(v) => emit('update', 'arrayField', v)"
    />
    <SharedFieldHint
      text="Имя поля, содержащего массив. Каждый элемент будет передан следующей ноде как отдельный input."
      example="items"
    />
  </UiField>

  <p class="rounded-md border border-border bg-card px-2.5 py-2 text-micro text-muted">
    Каждый элемент массива будет передан следующей ноде для обработки.
  </p>
</template>
