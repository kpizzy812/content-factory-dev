<script setup lang="ts">
/**
 * Состояние конвейера: включён он или нет.
 * Это не прогресс запуска — у запусков свой статус в мониторе.
 */
const props = defineProps<{
  status: string
}>()

const meta = computed(() => props.status === 'active'
  ? { label: 'Активен', tone: 'border-success-border bg-success-bg text-success' }
  : { label: 'Выключен', tone: 'border-divider bg-transparent text-subtle' })
</script>

<template>
  <span
    class="inline-flex h-[18px] w-fit shrink-0 items-center rounded-sm border px-1.5 text-micro whitespace-nowrap"
    :class="meta.tone"
  >
    {{ meta.label }}
  </span>
</template>
