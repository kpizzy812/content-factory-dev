<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

function numberValue(event: Event, fallback: number): number {
  const value = Number((event.target as HTMLInputElement).value)
  return Number.isFinite(value) ? value : fallback
}
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Этап проверки</legend>
    <select
      class="select select-sm w-full"
      :value="config.stage || 'script'"
      @change="emit('update', 'stage', ($event.target as HTMLSelectElement).value)"
    >
      <option value="script">Сценарий перед монтажом</option>
      <option value="final">Готовое видео перед публикацией</option>
    </select>
    <SharedFieldHint text="Для полного контроля поставьте две ноды: после сценария и после генерации видео." />
  </fieldset>

  <div class="grid grid-cols-2 gap-2">
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Мин. секунд</legend>
      <input
        type="number"
        min="10"
        class="input input-sm w-full"
        :value="config.minDurationSec ?? 70"
        @input="emit('update', 'minDurationSec', numberValue($event, 70))"
      />
    </fieldset>
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Макс. секунд</legend>
      <input
        type="number"
        min="10"
        class="input input-sm w-full"
        :value="config.maxDurationSec ?? 90"
        @input="emit('update', 'maxDurationSec', numberValue($event, 90))"
      />
    </fieldset>
  </div>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Минимальная оценка AI-критика</legend>
    <input
      type="number"
      min="0"
      max="100"
      class="input input-sm w-full"
      :value="config.minCriticScore ?? 70"
      @input="emit('update', 'minCriticScore', numberValue($event, 70))"
    />
  </fieldset>

  <fieldset class="fieldset space-y-2">
    <label class="flex items-center justify-between gap-3 cursor-pointer">
      <span class="text-xs">Требовать активную воронку</span>
      <input
        type="checkbox"
        class="toggle toggle-sm"
        :checked="config.requireFunnel !== false"
        @change="emit('update', 'requireFunnel', ($event.target as HTMLInputElement).checked)"
      />
    </label>
    <label class="flex items-center justify-between gap-3 cursor-pointer">
      <span class="text-xs">Требовать утверждённый лид-магнит</span>
      <input
        type="checkbox"
        class="toggle toggle-sm"
        :checked="config.requireApprovedLeadMagnet !== false"
        @change="emit('update', 'requireApprovedLeadMagnet', ($event.target as HTMLInputElement).checked)"
      />
    </label>
    <label class="flex items-center justify-between gap-3 cursor-pointer">
      <span class="text-xs">Блокировать следующий этап при ошибке</span>
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-error"
        :checked="config.blockOnFailure !== false"
        @change="emit('update', 'blockOnFailure', ($event.target as HTMLInputElement).checked)"
      />
    </label>
  </fieldset>
</template>
