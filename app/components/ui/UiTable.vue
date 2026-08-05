<script setup lang="ts">
/**
 * Операторская таблица. Источник: design-preview/_system/blocks/EntityTable*.html
 *
 * Это не <table>, а CSS-грид: колонки задаются одной строкой шаблона и
 * одинаковы у шапки и у строк, поэтому ширины не разъезжаются при скрытии
 * колонок. Горизонтальный скролл живёт внутри контейнера — страница
 * никогда не едет вбок.
 */
const props = defineProps<{
  /** grid-template-columns, например '32px 40px minmax(220px,1fr) 108px'. */
  columns: string
  /** Минимальная ширина, ниже которой включается горизонтальный скролл. */
  minWidth?: string
}>()

provide('uiTableColumns', computed(() => props.columns))
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-border">
    <div :style="{ minWidth }">
      <slot />
    </div>
  </div>
</template>
