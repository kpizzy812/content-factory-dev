<script setup lang="ts">
/**
 * Список свойств сущности. Источник: design-preview/_system/blocks/KeyValue.html
 *
 * Значения по умолчанию моноширинные: тут почти всегда ID, числа, размеры и
 * стоимость, и они должны выравниваться по вертикали.
 */
export interface KeyValueItem {
  label: string
  value?: string | number | null
  mono?: boolean
  /** Ссылка на связанную сущность. */
  to?: string
}

withDefaults(defineProps<{
  items: KeyValueItem[]
  labelWidth?: string
}>(), { labelWidth: '112px' })
</script>

<template>
  <div class="flex flex-col">
    <div
      v-for="item in items"
      :key="item.label"
      class="flex gap-3 border-b border-divider py-1.5 last:border-b-0"
    >
      <span class="shrink-0 text-sm text-muted" :style="{ width: labelWidth }">{{ item.label }}</span>
      <NuxtLink v-if="item.to" :to="item.to" class="truncate text-sm">{{ item.value }}</NuxtLink>
      <span v-else class="tnum text-sm" :class="item.mono !== false && 'font-mono'">
        {{ item.value ?? '—' }}
      </span>
    </div>
  </div>
</template>
