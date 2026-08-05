<script setup lang="ts">
/** Шапка таблицы. Источник: design-preview/_system/blocks/EntityTableHead.html */
const columns = inject<ComputedRef<string>>('uiTableColumns')
</script>

<template>
  <div
    class="grid h-8 items-center gap-x-3 border-b border-border bg-card px-3 text-micro tracking-[.06em] text-subtle uppercase"
    :style="{ gridTemplateColumns: columns }"
  >
    <slot />
  </div>
</template>
