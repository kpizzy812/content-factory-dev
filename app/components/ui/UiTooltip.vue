<script setup lang="ts">
/**
 * Подсказка при наведении. Источник: design-preview/_system/blocks/RefreshIndicator.html
 *
 * В подсказку не прячутся операционные величины — стоимость, лимиты и возраст
 * задачи должны быть видны без наведения. Здесь только пояснения.
 */
const props = withDefaults(defineProps<{
  text: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
}>(), { placement: 'top' })

/**
 * Боковые подсказки понадобились палитре редактора: описание блока рядом со
 * строкой, а не над ней — сверху оно перекрывает соседний блок списка.
 */
const position = computed(() => ({
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-1.5 -translate-y-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
}[props.placement]))
</script>

<template>
  <span class="group/tip relative inline-flex">
    <slot />
    <span
      role="tooltip"
      class="pointer-events-none absolute z-40 w-max max-w-64 rounded-md border border-border bg-raised px-2 py-1 text-[11.5px] text-muted opacity-0 shadow-md transition-opacity duration-(--duration-fast) ease-out group-hover/tip:opacity-100"
      :class="position"
    >
      {{ text }}
    </span>
  </span>
</template>
