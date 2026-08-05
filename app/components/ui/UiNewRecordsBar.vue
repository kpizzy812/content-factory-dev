<script setup lang="ts">
/**
 * Плашка «＋N новых». Источник: design-preview/_system/blocks/NewRecordsBar.html
 *
 * При поллинге раз в 5 с новые записи НЕ вставляются в список на лету: это
 * сдвигает строки под курсором и ломает выделение. Они копятся здесь и
 * подмешиваются только по клику.
 */
defineProps<{ count: number }>()
defineEmits<{ show: [] }>()
</script>

<template>
  <button
    v-if="count > 0"
    type="button"
    class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-info-border bg-info-bg py-1.5 text-sm text-info hover:bg-info hover:text-inverse"
    @click="$emit('show')"
  >
    <Icon name="mingcute:arrow-up-line" />
    <span class="tnum">＋{{ count }} новых</span>
  </button>
</template>
