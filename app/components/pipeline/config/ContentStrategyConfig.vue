<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()
</script>

<template>
  <UiField label="Приложение">
    <UiInput
      :model-value="config.appId || ''"
      type="number"
      min="1"
      placeholder="Берётся из фабричного запуска"
      @update:model-value="(v) => emit('update', 'appId', Number(v) || undefined)"
    />
    <SharedFieldHint text="Можно не указывать для запуска из контент-завода. Тогда приложение берётся из производственного цикла." />
  </UiField>

  <UiField label="Готовая воронка">
    <UiInput
      :model-value="config.funnelId || ''"
      placeholder="ID активной воронки"
      @update:model-value="(v) => emit('update', 'funnelId', v.trim() || undefined)"
    />
    <SharedFieldHint text="Если указана активная воронка, её кодовое слово обязательно попадёт в CTA. Без неё система создаст лид-магнит в черновике." />
  </UiField>

  <div class="flex items-start justify-between gap-3">
    <span class="min-w-0">
      <span class="block font-medium">Учитывать свою статистику</span>
      <span class="block text-micro text-subtle">Просмотры, удержание, CTR и реакции последних роликов</span>
    </span>
    <UiToggle
      :model-value="config.useInternalMetrics !== false"
      @update:model-value="(v) => emit('update', 'useInternalMetrics', v)"
    />
  </div>

  <div class="flex items-start justify-between gap-3">
    <span class="min-w-0">
      <span class="block font-medium">Использовать банк трендов</span>
      <span class="block text-micro text-subtle">Берёт свежие тренды и готовые идеи приложения без отдельного поиска на каждый ролик</span>
    </span>
    <UiToggle
      :model-value="config.useTrendBank !== false"
      @update:model-value="(v) => emit('update', 'useTrendBank', v)"
    />
  </div>
</template>
