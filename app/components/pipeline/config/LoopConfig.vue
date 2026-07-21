<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Поле с массивом данных</legend>
    <input
      :value="config.arrayField || 'items'"
      class="input input-sm w-full"
      placeholder="items"
      @input="emit('update', 'arrayField', ($event.target as HTMLInputElement).value)"
    />
    <SharedFieldHint text="Имя поля, содержащего массив. Каждый элемент будет передан следующей ноде как отдельный input." example="items" />
  </fieldset>

  <div class="p-2 rounded-box bg-base-200 text-[10px] text-base-content/60">
    <p>Каждый элемент массива будет передан следующей ноде для обработки.</p>
  </div>
</template>
