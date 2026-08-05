<script setup lang="ts">
/**
 * Пустое состояние. Источник: design-preview/_system/blocks/EmptyState.html
 *
 * Три разных случая, которые нельзя смешивать:
 *   first  — здесь ещё ничего нет, объясняем с чего начать
 *   search — по фильтрам ничего не нашлось, называем мешающий фильтр
 *   denied — нет прав, объясняем к кому идти
 * Один общий «Ничего не найдено» на все три оставляет человека без следующего шага.
 */
withDefaults(defineProps<{
  variant?: 'first' | 'search' | 'denied'
  icon?: string
  title: string
  description?: string
}>(), { variant: 'first' })
</script>

<template>
  <div class="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border px-6 py-12 text-center">
    <Icon
      :name="icon ?? (variant === 'denied' ? 'mingcute:lock-line' : variant === 'search' ? 'mingcute:search-line' : 'mingcute:inbox-line')"
      class="text-2xl"
      :class="variant === 'denied' ? 'text-warning' : 'text-subtle'"
    />
    <div class="text-lg font-medium">{{ title }}</div>
    <p v-if="description" class="max-w-md text-sm text-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-1.5 flex gap-2">
      <slot />
    </div>
  </div>
</template>
