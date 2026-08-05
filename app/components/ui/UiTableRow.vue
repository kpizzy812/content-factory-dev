<script setup lang="ts">
/**
 * Строка таблицы. Источник: design-preview/_system/blocks/EntityTableRow.html
 *
 * Две плотности: 36 px для текстовых строк и 44 px там, где есть превью или
 * аватар — при 36 px миниатюра 32×32 оставляет 2 px на отступы и склеивается.
 * Действия появляются на ховере и не занимают место постоянно.
 */
withDefaults(defineProps<{
  density?: 'text' | 'media'
  selected?: boolean
  clickable?: boolean
}>(), { density: 'text', clickable: true })

const columns = inject<ComputedRef<string>>('uiTableColumns')
</script>

<template>
  <div
    class="group grid items-center gap-x-3 border-b border-divider px-3 transition-colors duration-(--duration-fast) ease-out"
    :style="{ gridTemplateColumns: columns }"
    :class="[
      density === 'media' ? 'h-11' : 'h-9',
      selected ? 'bg-accent-bg' : 'hover:bg-card',
      clickable ? 'cursor-pointer' : '',
    ]"
  >
    <slot />
  </div>
</template>
