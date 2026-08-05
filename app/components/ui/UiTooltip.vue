<script setup lang="ts">
/**
 * Подсказка при наведении. Источник: design-preview/_system/blocks/RefreshIndicator.html
 *
 * В подсказку не прячутся операционные величины — стоимость, лимиты и возраст
 * задачи должны быть видны без наведения. Здесь только пояснения.
 */
withDefaults(defineProps<{
  text: string
  placement?: 'top' | 'bottom'
}>(), { placement: 'top' })
</script>

<template>
  <span class="group/tip relative inline-flex">
    <slot />
    <span
      role="tooltip"
      class="pointer-events-none absolute left-1/2 z-40 w-max max-w-64 -translate-x-1/2 rounded-md border border-border bg-raised px-2 py-1 text-[11.5px] text-muted opacity-0 shadow-md transition-opacity duration-(--duration-fast) ease-out group-hover/tip:opacity-100"
      :class="placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'"
    >
      {{ text }}
    </span>
  </span>
</template>
