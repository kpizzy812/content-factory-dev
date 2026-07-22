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
    <legend class="fieldset-legend">Приложение</legend>
    <input
      :value="config.appId || ''"
      type="number"
      min="1"
      class="input input-sm w-full"
      placeholder="Берётся из фабричного запуска"
      @input="emit('update', 'appId', Number(($event.target as HTMLInputElement).value) || undefined)"
    />
    <SharedFieldHint text="Можно не указывать для запуска из контент-завода. Тогда приложение берётся из производственного цикла." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Готовая воронка</legend>
    <input
      :value="config.funnelId || ''"
      type="text"
      class="input input-sm w-full"
      placeholder="ID активной воронки"
      @input="emit('update', 'funnelId', ($event.target as HTMLInputElement).value.trim() || undefined)"
    />
    <SharedFieldHint text="Если указана активная воронка, её кодовое слово обязательно попадёт в CTA. Без неё система создаст лид-магнит в черновике." />
  </fieldset>

  <fieldset class="fieldset">
    <label class="flex items-center justify-between gap-3 cursor-pointer">
      <span>
        <span class="block text-xs font-medium">Учитывать свою статистику</span>
        <span class="block text-[10px] text-base-content/50">Просмотры, удержание, CTR и реакции последних роликов</span>
      </span>
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="config.useInternalMetrics !== false"
        @change="emit('update', 'useInternalMetrics', ($event.target as HTMLInputElement).checked)"
      />
    </label>
  </fieldset>

  <fieldset class="fieldset">
    <label class="flex items-center justify-between gap-3 cursor-pointer">
      <span>
        <span class="block text-xs font-medium">Использовать банк трендов</span>
        <span class="block text-[10px] text-base-content/50">Берёт свежие тренды и готовые идеи приложения без отдельного поиска на каждый ролик</span>
      </span>
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="config.useTrendBank !== false"
        @change="emit('update', 'useTrendBank', ($event.target as HTMLInputElement).checked)"
      />
    </label>
  </fieldset>
</template>
