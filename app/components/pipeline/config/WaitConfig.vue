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
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Задержка</legend>
    <select
      class="select select-sm w-full"
      :value="config.delaySeconds || 5"
      @change="emit('update', 'delaySeconds', Number(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="opt in delayOptions" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <SharedFieldHint text="Время паузы перед продолжением конвейера. Полезно для rate limiting внешних API." />
  </fieldset>
</template>
