<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const delayOptions = [
  { value: 5, label: '5 секунд' },
  { value: 30, label: '30 секунд' },
  { value: 60, label: '1 минута' },
  { value: 300, label: '5 минут' },
  { value: 900, label: '15 минут' },
]
</script>

<template>
  <UiField label="Задержка">
    <UiSelect
      :model-value="config.delaySeconds || 5"
      :options="delayOptions"
      @update:model-value="(v) => emit('update', 'delaySeconds', Number(v))"
    />
    <SharedFieldHint text="Время паузы перед продолжением конвейера. Полезно для rate limiting внешних API." />
  </UiField>
</template>
