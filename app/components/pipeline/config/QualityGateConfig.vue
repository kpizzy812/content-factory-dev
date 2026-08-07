<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const stageOptions = [
  { value: 'script', label: 'Сценарий перед монтажом' },
  { value: 'final', label: 'Готовое видео перед публикацией' },
]

function numberValue(raw: string | number, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}
</script>

<template>
  <UiField label="Этап проверки">
    <UiSelect
      :model-value="config.stage || 'script'"
      :options="stageOptions"
      @update:model-value="(v) => emit('update', 'stage', v)"
    />
    <SharedFieldHint text="Для полного контроля поставьте две ноды: после сценария и после генерации видео." />
  </UiField>

  <div class="grid grid-cols-2 gap-2">
    <UiField label="Мин. секунд">
      <UiInput
        type="number"
        min="10"
        :model-value="config.minDurationSec ?? 70"
        @update:model-value="(v) => emit('update', 'minDurationSec', numberValue(v, 70))"
      />
    </UiField>
    <UiField label="Макс. секунд">
      <UiInput
        type="number"
        min="10"
        :model-value="config.maxDurationSec ?? 90"
        @update:model-value="(v) => emit('update', 'maxDurationSec', numberValue(v, 90))"
      />
    </UiField>
  </div>

  <UiField label="Минимальная оценка AI-критика">
    <UiInput
      type="number"
      min="0"
      max="100"
      :model-value="config.minCriticScore ?? 70"
      @update:model-value="(v) => emit('update', 'minCriticScore', numberValue(v, 70))"
    />
  </UiField>

  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <span>Требовать активную воронку</span>
      <UiToggle
        :model-value="config.requireFunnel !== false"
        @update:model-value="(v) => emit('update', 'requireFunnel', v)"
      />
    </div>
    <div class="flex items-center justify-between gap-3">
      <span>Требовать утверждённый лид-магнит</span>
      <UiToggle
        :model-value="config.requireApprovedLeadMagnet !== false"
        @update:model-value="(v) => emit('update', 'requireApprovedLeadMagnet', v)"
      />
    </div>
    <div class="flex items-center justify-between gap-3">
      <span>Блокировать следующий этап при ошибке</span>
      <UiToggle
        :model-value="config.blockOnFailure !== false"
        @update:model-value="(v) => emit('update', 'blockOnFailure', v)"
      />
    </div>
  </div>
</template>
