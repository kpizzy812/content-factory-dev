<script setup lang="ts">
/**
 * Индикатор фонового обновления. Источник: design-preview/_system/blocks/RefreshIndicator.html
 *
 * Поллинг идёт раз в 5 секунд по всему приложению, поэтому индикатор
 * намеренно тихий: точка меняет цвет, ничего не мигает и не сдвигает вёрстку.
 * Место под подпись зарезервировано, чтобы соседние элементы не прыгали.
 */
defineProps<{
  pending?: boolean
  /** Время последнего успешного обновления, уже отформатированное. */
  updatedAt?: string
}>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-[11.5px] text-subtle" :title="updatedAt ? `Обновлено в ${updatedAt}` : undefined">
    <span
      class="size-1.5 shrink-0 rounded-full transition-colors duration-(--duration-base) ease-out"
      :class="pending ? 'bg-info' : 'bg-neutral-border'"
    />
    <span class="tnum min-w-[52px]">{{ updatedAt ?? '' }}</span>
  </span>
</template>
